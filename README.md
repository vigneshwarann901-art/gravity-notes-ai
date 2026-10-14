# Gravity Notes — AI-Powered Spatial Thinking Workspace

Gravity Notes is a force-directed spatial mind-mapping application upgraded with a context-aware **Gemini AI Thinking Copilot**. It preserves 100% of the original neon physics canvas, spring connections, tag clustering, and offline `localStorage` persistence while adding six structured AI graph workflows.

---

## 1. Local Setup & Running Instructions

### Option A: Production-Safe Server Proxy Mode (Recommended)
Requires **Node.js 18+** (zero external npm packages needed):

1. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env

````

2. Add your Gemini API key from [Google AI Studio](https://aistudio.google.com/) to `.env`:

   Ini, TOML
   ```
   GEMINI_API_KEY=AIzaSyYourActualKeyHere
   GEMINI_MODEL=gemini-3.5-flash-lite
   PORT=3000

   ```
3. Run syntax verification and start the server:

   Bash
   ```
   npm run check
   npm start

   ```
4. Open `http://localhost:3000` in your browser. The AI Copilot header will display a green **`Server Proxy`** badge automatically.

### Option B: Standalone Browser Prototype Mode (Memory-Only BYOK)

If you open `index.html` directly in a browser or host it on a static site without a backend:

1. Click **⚙ AI Connection & Model Settings** in the AI Copilot panel.
2. Switch **Connection Mode** to **`Bring Your Own API Key (Memory-Only Prototype)`**.
3. Paste your Gemini API key and click **Set Key**.
4. **Limitations of Browser BYOK Mode:** Browser-side requests send the API key directly from your browser tab to `generativelanguage.googleapis.com`. While the key is held strictly in a private JavaScript closure variable in RAM (never written to `localStorage`, `sessionStorage`, cookies, or exported files) and is wiped as soon as you close or refresh the tab, browser-side keys are visible in your own browser's DevTools network tab and must **never** be used for a shared public production service.

## 2. Security Guarantees

- **Zero Hardcoded Secrets:** No API keys exist in `index.html`, `server.js`, or any configuration file committed to version control.
- **Clean Exports & Autosaves:** `save()`, `.md` export, `.json` export, and the built-in `⬇ Project .ZIP` generator explicitly serialize only workspace graph fields (`nodes`, `links`, `view`, `gravity`, `nodeCounter`).
- **Dotfile Protection:** `server.js` explicitly blocks HTTP access to `.env` and path traversal sequences.
- **Rate Limiting & Payload Caps:** `server.js` enforces a 30 requests/minute per-IP sliding window limit and a 250KB request body cap, while the frontend caps context serialization at 60 prioritized nodes per prompt.

## 3. Verified Gemini API Models & Automatic Fallback

The application targets the official Gemini Developer API `v1beta` endpoints:

- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`

Because model availability varies between newly created Google AI Studio projects and legacy projects, both the proxy and client implement automatic `404 NOT_FOUND` fallback across:

1. `gemini-3.8-flash` (Default — Latest Stable Flash model)
2. `gemini-3.5-flash-lite` (High-speed, cost-efficient Stable Flash-Lite)
3. `gemini-2.5-flash` (Stable 2.5 Flash)
4. `gemini-2.5-pro` (Deep reasoning 2.5 Pro)
5. `gemini-flash-latest` (Dynamic latest alias)

## 4. Deploying Publicly

### Deploy Full-Stack (Frontend + `/api/ai` Proxy) to Render / Railway / Fly.io / Cloud Run

1. Push `index.html`, `server.js`, `package.json`, and `.gitignore` to a GitHub repository (verify `.env` is ignored via `git status`).
2. Create a new Web Service on **Render**, **Railway**, or **Google Cloud Run**.
3. Set Build Command to `npm run check` and Start Command to `npm start`.
4. Add the environment secret `GEMINI_API_KEY` in your hosting provider's dashboard.

### Verification Commands (Run Locally)

Bash

```
# 1. Verify server.js syntax
node --check server.js

# 2. Check proxy health endpoint
curl http://localhost:3000/api/ai/health

```


## 5. Publish on Render (full-stack)

This repository includes `render.yaml` for a Render Blueprint deployment. It deploys the webpage and `/api/ai` server together, so the public site can use the server-side Gemini proxy.

1. Push the project files to a GitHub repository. Do **not** upload `.env`; it is ignored by `.gitignore`.
2. In Render, choose **New → Blueprint**, connect your GitHub account, and select the repository containing `render.yaml`.
3. When Render prompts for `GEMINI_API_KEY`, enter your key into the Render dashboard prompt. Never put the real key in GitHub or in `render.yaml`.
4. Keep `GEMINI_MODEL` set to `gemini-3.5-flash-lite` initially, since that is the model confirmed working during local testing.
5. Wait for the deployment to finish, then open the `onrender.com` URL shown by Render and test an AI prompt.

The Blueprint uses Render's free web-service plan; free instances have usage/sleep limitations. The app's canvas autosaves to the current browser's local storage, not to a shared cloud database.
