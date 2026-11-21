# NOVA AI

Mobile-first Gothic Cyberpunk AI Studio. The permanent purple-black heroine home screen and the six main sections are kept intact.

## What works now

- Chat UI with local conversation history.
- Cloudflare Pages Function for the NOVA chat API.
- Cloudflare Workers AI integration (no OpenAI key required).
- Image generation endpoint is implemented with Cloudflare Workers AI FLUX (deployment/limits must be verified).
- Video idea drafts can be saved locally. Optional, fully local Wan2.1 rendering uses ComfyUI and has no hosted API key, subscription, or usage limit.
- Character selection and a local 18+ mode toggle.
- Optional Supabase sign-in and cloud library (requires a free Supabase project).
- PWA shell and GitHub Pages design preview.

Image generation is implemented in Image Studio via Cloudflare Pages Functions and Workers AI FLUX. Video Studio always supports local storyboard drafts. Video rendering is deliberately local: it sends jobs to a Wan2.1 workflow in ComfyUI running on the same computer, through the included companion server. No paid video API is used.

## Free deployment: Cloudflare Pages + Workers AI

The repository contains a Cloudflare Pages config (`wrangler.toml`) and Pages Functions in `functions/api/`.

1. Create a free account at [Cloudflare](https://dash.cloudflare.com/).
2. Open **Workers & Pages → Create → Pages → Connect to Git** and select `ivan939-blip/-NOVA-AI`.
3. Set the production branch to `main`, framework preset to **Vite**, build command to `npm run build`, and build output directory to `dist`.
4. The repository's `wrangler.toml` already declares the Workers AI binding as `AI`. Because this file is the configuration source of truth, make sure the Pages project deploys with Wrangler configuration enabled and check **Settings → Bindings** if the binding is not shown.
5. Redeploy the project. Open `https://YOUR-PROJECT.pages.dev/api/health`. It should return JSON with `"ai": true`.
6. Open the site and test the Chat tab.

### Free local video rendering: Wan2.1 + ComfyUI

This path has no account, API key, subscription, or hosted usage quota. It uses your own computer's GPU and electricity. A modern NVIDIA GPU with at least 8 GB VRAM is the practical minimum for the Wan2.1 1.3B model at 480p.

1. Install [ComfyUI](https://www.comfy.org/) locally and install/download the [Wan2.1 1.3B model](https://github.com/Wan-Video/Wan2.1).
2. Build a working Wan2.1 workflow in ComfyUI, save it in **API format** as `comfyui/wan2.1-api-workflow.json`, and put `{{NOVA_PROMPT}}` in its text prompt node. Optional placeholders are `{{NOVA_SECONDS}}` and `{{NOVA_ASPECT_RATIO}}`.
3. Start ComfyUI on `http://127.0.0.1:8188`, then in this project run `npm run video:local`. The companion server listens only on `127.0.0.1:8189` by default.
4. Open NOVA in the browser on the same computer. The **Генерувати локально (Wan2.1)** button will queue the job, poll its progress, and display the finished file.

The default companion CORS policy permits `https://nova-ai-7qd.pages.dev` and Vite's local server. To use a different NOVA domain, set `NOVA_ALLOWED_ORIGINS=https://your-domain.example` before starting it. To use another companion URL, set `VITE_LOCAL_VIDEO_API_URL` at build time.

The chat endpoint uses Cloudflare Workers AI model `@cf/zai-org/glm-4.7-flash`. Cloudflare's free plan includes a limited daily AI allowance; availability and limits are controlled by Cloudflare. Do not upgrade the account or add a payment method just for this project. If the free allowance is exhausted, the API will temporarily stop answering until it resets.

## Optional free cloud library

Supabase is optional. The app continues to keep chat history and draft concepts locally without it. To enable cloud accounts and library sync, create a free Supabase project, run [supabase/schema.sql](supabase/schema.sql), then add these build-time environment variables in Cloudflare Pages:

```text
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

The publishable key is designed for browser use; never put a Supabase service-role key in frontend variables.

## CI and static previews

GitHub Actions verifies tests and the Vite build on every push to `main`. Cloudflare Pages performs the production deployment; its Pages Functions are required for the AI endpoints. A static host such as GitHub Pages cannot execute `functions/api/`.

## Run locally

```bash
npm install
npm run dev
npm run build
```

To run Pages Functions locally with the AI binding, use Wrangler and authenticate with a Cloudflare account:

```bash
npx wrangler pages dev dist --ai AI
```
