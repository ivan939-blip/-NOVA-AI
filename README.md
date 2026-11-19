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
