// Gravity Notes — Production-Safe Node.js Server & Gemini API Proxy
// Zero external dependencies required (uses built-in Node 18+ http, fs, path, fetch)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// Optional .env file loader (if a local .env file exists)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest'
];

// Per-IP sliding window rate limiter (30 requests per minute)
const rateMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60000;
  }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count <= 30;
}

function readJsonBody(req, maxBytes = 250000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Request payload exceeds 250KB limit.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Malformed JSON request body.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local';

  // 1. Health endpoint
  if (req.method === 'GET' && url.pathname === '/api/ai/health') {
    return sendJson(res, 200, {
      ok: true,
      configured: Boolean(GEMINI_API_KEY),
      defaultModel: DEFAULT_MODEL
    });
  }

  // 2. Gemini API Proxy Endpoints (/api/ai/generate & /api/ai/stream)
  if (req.method === 'POST' && (url.pathname === '/api/ai/generate' || url.pathname === '/api/ai/stream')) {
    if (!GEMINI_API_KEY) {
      return sendJson(res, 503, {
        message: 'Server GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in your environment or .env file.'
      });
    }
    if (!checkRateLimit(ip)) {
      return sendJson(res, 429, {
        message: 'Rate limit exceeded (max 30 AI requests per minute). Please wait a moment.'
      });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { message: err.message });
    }

    const preferred = body.model || DEFAULT_MODEL;
    const chain = [preferred, ...FALLBACK_MODELS.filter((m) => m !== preferred)];

    // 2A. Structured JSON Generation
    if (url.pathname === '/api/ai/generate') {
      let lastErr = null;
      let lastErrStatus = 404;
      for (const model of chain) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        const upstream = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: String(body.systemInstruction || '') }] },
            contents: [{ role: 'user', parts: [{ text: String(body.userPrompt || '') }] }],
            generationConfig: {
              temperature: 0.4,
              responseMimeType: 'application/json',
              responseSchema: body.responseSchema
            }
          })
        });

        const data = await upstream.json().catch(() => ({}));
        if ([404, 500, 503].includes(upstream.status)) {
          lastErr = data;
          lastErrStatus = upstream.status;
          continue;
        }
        if (!upstream.ok) {
          return sendJson(res, upstream.status, data);
        }

        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
        try {
          const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
          return sendJson(res, 200, { modelUsed: model, result: JSON.parse(cleaned) });
        } catch (e) {
          return sendJson(res, 502, { message: 'Model returned invalid JSON structure.', raw: text.slice(0, 400) });
        }
      }
      return sendJson(res, lastErrStatus, lastErr || { message: 'All candidate Gemini models failed. Please retry shortly or choose another model.' });
    }

    // 2B. Server-Sent Events (SSE) Streaming Generation
    let lastStreamError = null;
    let lastStreamStatus = 404;
    for (const model of chain) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: String(body.systemInstruction || '') }] },
          contents: [{ role: 'user', parts: [{ text: String(body.userPrompt || '') }] }],
          generationConfig: { temperature: 0.5 }
        })
      });

      if ([404, 500, 503].includes(upstream.status)) {
        lastStreamStatus = upstream.status;
        lastStreamError = await upstream.json().catch(() => ({}));
        continue;
      }
      if (!upstream.ok) {
        const errData = await upstream.json().catch(() => ({}));
        return sendJson(res, upstream.status, errData);
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      });

      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      res.end();
      return;
    }
    return sendJson(res, lastStreamStatus, lastStreamError || { message: 'All candidate streaming models failed. Please retry shortly or choose another model.' });
  }

  // 3. Static File Serving
  const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(__dirname, safePath);

  if (!fullPath.startsWith(__dirname) || path.basename(fullPath).startsWith('.env')) {
    return sendJson(res, 403, { message: 'Forbidden' });
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) return sendJson(res, 404, { message: 'File not found' });
    const ext = path.extname(fullPath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`✦ Gravity Notes AI Workspace listening on http://localhost:${PORT}`);
  console.log(`✦ Server Proxy Configured: ${Boolean(GEMINI_API_KEY)} (Default model: ${DEFAULT_MODEL})`);
});
