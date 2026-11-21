# NOVA AI Android APK

This Android build uses Capacitor 7 to wrap the **existing Cloudflare Pages deployment** at https://nova-ai-7qd.pages.dev. It does not redesign the NOVA AI interface.

## Build an installable debug APK without a PC

1. In GitHub open **Actions → Build NOVA AI Android APK → Run workflow**.
2. After the run succeeds, download the **NOVA-AI-Android-debug-APK** artifact.
3. Extract the ZIP and install `app-debug.apk` on Android after approving installation from that source.

The Android app needs internet access. It loads the live Cloudflare Pages deployment, so its chat and image APIs depend on the live Cloudflare Workers AI binding, model availability, and free quotas. Local-only video generation on a desktop companion server is not available on the phone.

The debug APK is for testing, not Google Play release. For distribution, create a properly signed release APK/AAB, establish a permanent app ID, icons, and privacy policy, and verify the deployment and runtime functions.

This workflow is manually triggered to avoid unnecessary Android builds. It does not modify Cloudflare settings or secrets.
