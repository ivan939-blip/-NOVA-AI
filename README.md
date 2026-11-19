# NOVA AI

Mobile-first Gothic Cyberpunk AI Studio. The permanent purple-black heroine home screen and the six main sections are kept intact.

## What works now

- Chat UI with local conversation history.
- Cloudflare Pages Function for the NOVA chat API.
- Cloudflare Workers AI integration (no OpenAI key required).
- Image and video idea drafts saved to the local library.
- Character selection and a local 18+ mode toggle.
- Optional Supabase sign-in and cloud library (requires a free Supabase project).
- PWA shell and GitHub Pages design preview.

Image and video rendering are not enabled in this free build yet. The Image Studio and Video Studio clearly save concepts only; they do not pretend to render media.

## Free deployment: Cloudflare Pages + Workers AI

The repository contains a Cloudflare Pages config (`wrangler.toml`) and Pages Functions in `functions/api/`.

1. Create a free account at [Cloudflare](https://dash.cloudflare.com/).
2. Open **Workers & Pages → Create → Pages → Connect to Git** and select `ivan939-blip/-NOVA-AI`.
3. Set the production branch to `main`, framework preset to **Vite**, build command to `npm run build`, and build output directory to `dist`.
4. The repository's `wrangler.toml` already declares the Workers AI binding as `AI`. Because this file is the configuration source of truth, make sure the Pages project deploys with Wrangler configuration enabled and check **Settings → Bindings** if the binding is not shown.
5. Redeploy the project. Open `https://YOUR-PROJECT.pages.dev/api/health`. It should return JSON with `"ai": true`.
6. Open the site and test the Chat tab.

The chat endpoint uses Cloudflare Workers AI model `@cf/zai-org/glm-4.7-flash`. Cloudflare's free plan includes a limited daily AI allowance; availability and limits are controlled by Cloudflare. Do not upgrade the account or add a payment method just for this project. If the free allowance is exhausted, the API will temporarily stop answering until it resets.

## Optional free cloud library

Supabase is optional. The app continues to keep chat history and draft concepts locally without it. To enable cloud accounts and library sync, create a free Supabase project, run [supabase/schema.sql](supabase/schema.sql), then add these build-time environment variables in Cloudflare Pages:

```text
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

The publishable key is designed for browser use; never put a Supabase service-role key in frontend variables.

## GitHub Pages preview

The GitHub Actions workflow still builds and publishes the static design preview at:

https://ivan939-blip.github.io/-NOVA-AI/

GitHub Pages cannot execute the `functions/api/` server endpoints. For working AI chat, use the Cloudflare Pages deployment above.

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
