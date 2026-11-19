# NOVA AI

Mobile-first Gothic Cyberpunk AI Studio. This first release is a PWA shell with:

- Chat interface and local browser history
- Image/Video concept drafts saved in **My Library**
- Character selection and an age-gated private space
- Offline-ready PWA configuration

## Run locally

```bash
npm install
npm run dev
```

The AI generation buttons deliberately save drafts only. A production AI backend, accounts, and cloud library have not yet been connected.

## Free hosting preparation

`.github/workflows/deploy-pages.yml` is ready to deploy on GitHub Pages after the repository's **Settings → Pages → Source** is set to **GitHub Actions**. It does not provision any paid resource.

After the first successful deployment, the app will be available at https://ivan939-blip.github.io/-NOVA-AI/

## AI, accounts, and cloud library

The repository is now ready for a secure Vercel deployment. Vercel serves `api/chat.js`, which calls the OpenAI Responses API **only on the server**; `OPENAI_API_KEY` is never sent to the browser. Set these values in the Vercel project settings, then redeploy:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

For the database, create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor. It enables Row Level Security, so each signed-in user can access only their own library entries. The value `VITE_SUPABASE_PUBLISHABLE_KEY` is intentionally public; the OpenAI key is secret and must stay in Vercel environment variables.

GitHub Pages remains the public design preview. Deploying to Vercel is required for the server-side AI endpoint and cloud authentication to work.
