# NOVA AI

Mobile-first Gothic Cyberpunk AI Studio. The permanent purple-black heroine home screen and the six main sections are kept intact.

## What works now

- Chat UI with local conversation history.
- Cloudflare Pages Function for the NOVA chat API.
- Cloudflare Workers AI integration (no OpenAI key required).
- Image generation endpoint is implemented with Cloudflare Workers AI FLUX (deployment/limits must be verified).
- Image Studio supports text-to-image, photo-reference transformation, chosen presentation and face preservation, structured scene description, NOVA Director art direction, and seed-based variations.
- Video idea drafts can be saved locally. Video Studio supports a real local neural-video route through ComfyUI/Wan workflows and a separate Motion Forge fallback that creates an MP4 from an image or NOVA neon background.
- Character selection and a local 18+ mode toggle.
- Optional Supabase sign-in and cloud library (requires a free Supabase project).
- PWA shell and GitHub Pages design preview.

Image generation is implemented in Image Studio via Cloudflare Pages Functions and Workers AI FLUX. Video Studio always supports local storyboard drafts. Neural video rendering is deliberately local: NOVA sends the prompt to a ComfyUI workflow running on the same computer, not to a paid video API. It needs a compatible GPU, ComfyUI, and locally downloaded model files. The included Motion Forge fallback uses FFmpeg and is not an AI-video model.

## Free deployment: Cloudflare Pages + Workers AI

The repository contains a Cloudflare Pages config (`wrangler.toml`) and Pages Functions in `functions/api/`.

1. Create a free account at [Cloudflare](https://dash.cloudflare.com/).
2. Open **Workers & Pages → Create → Pages → Connect to Git** and select `ivan939-blip/-NOVA-AI`.
3. Set the production branch to `main`, framework preset to **Vite**, build command to `npm run build`, and build output directory to `dist`.
4. The repository's `wrangler.toml` already declares the Workers AI binding as `AI`. Because this file is the configuration source of truth, make sure the Pages project deploys with Wrangler configuration enabled and check **Settings → Bindings** if the binding is not shown.
5. Redeploy the project. Open `https://YOUR-PROJECT.pages.dev/api/health`. It should return JSON with `"ai": true`.
6. Open the site and test the Chat tab.

### Free local video rendering: Motion Forge

This path has no account, API key, subscription, GPU model, or hosted usage quota. It uses a bundled FFmpeg binary locally and works on this computer's CPU.

1. In this project run `npm install`, then `npm run video:local`.
2. Open NOVA in the browser on the same computer. The **Створити безкоштовне відео** button queues a local MP4 job, polls its progress, and displays the file.
3. If an Image Studio image exists in the current session, Motion Forge uses it as the source frame. Otherwise, it creates a NOVA neon motion background with ambient audio.

The default companion CORS policy permits `https://nova-ai-7qd.pages.dev` and Vite's local server. To use a different NOVA domain, set `NOVA_ALLOWED_ORIGINS=https://your-domain.example` before starting it. To use another companion URL, set `VITE_LOCAL_VIDEO_API_URL` at build time.

### Free local neural video: ComfyUI / Wan

NOVA can run an actual neural-video workflow without a paid API. This cannot run inside Cloudflare Pages or directly in a phone browser: video models need local GPU memory and model files.

1. Install and run [ComfyUI](https://github.com/comfyanonymous/ComfyUI) on the computer that will create video. Install a Wan-compatible text-to-video or image-to-video workflow and model according to that workflow's own licence and hardware requirements.
2. In ComfyUI, export the working workflow in **API format**. In the JSON, replace the positive prompt input with `{{PROMPT}}`. Optional placeholders are `{{NEGATIVE_PROMPT}}`, `{{WIDTH}}`, `{{HEIGHT}}`, `{{FRAMES}}`, `{{SEED}}`, and `{{IMAGE_FILENAME}}` (for a Load Image node).
3. Start the NOVA companion in the same terminal:

```powershell
$env:NOVA_COMFYUI_URL='http://127.0.0.1:8188'
$env:NOVA_COMFY_WORKFLOW='C:\absolute\path\to\wan-api-workflow.json'
npm run video:local
```

4. In Video Studio choose **Нейромережа**. NOVA uploads the current Image Studio result only to local ComfyUI when the selected workflow uses `{{IMAGE_FILENAME}}`; generated MP4 files are retained for 24 hours locally.

If ComfyUI or its workflow is unavailable, NOVA shows a clear configuration error; it does not pretend that Motion Forge is a neural model. Choose **Motion Forge** for the CPU-only fallback. To use the companion from a phone, serve it from a trusted computer on the same local network and set `VITE_LOCAL_VIDEO_API_URL` to that computer's HTTPS/LAN endpoint before building the Android app.

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
