# Facade Field Survey

Installable web app (PWA) for Android (and iPhone). Photograph a building or upload photos, and Gemini analyzes the architecture against your California style reference, plus condition, materials, dating, architects, seismic/regulatory notes and field follow-ups. Surveys are saved on the device.

## Why a web app instead of an APK
An APK shared outside Google Play triggers "install unknown apps" and Play Protect warnings. A PWA served over HTTPS installs from Chrome with no such prompts, updates when you redeploy, and works on any phone from one link.

## Publish it (pick one, about 5 minutes)
**GitHub Pages:** create a public repo, upload everything in this folder, Settings > Pages > deploy from the main branch root. Share `https://<you>.github.io/<repo>/`.
**Netlify / Cloudflare Pages:** drag this folder onto app.netlify.com/drop (or Cloudflare Pages direct upload). The included `_headers` file applies strict security headers automatically.

## Users install it
Open the link in Chrome on Android > menu > Install app. (iPhone: Safari > Share > Add to Home Screen.) Then Settings tab > paste their own Gemini API key from aistudio.google.com/apikey > Save and test > "Load models available to my key".

## Security model
- Bring-your-own key: no key is shipped in the app, so nothing can be extracted and abused.
- The key is stored only on the user's device and sent only to generativelanguage.googleapis.com (in a header, never in a URL).
- Strict Content-Security-Policy: no third-party scripts, fonts or analytics. The only allowed network target is Google's Gemini API.
- Recommend users restrict their key in Google AI Studio / Cloud Console.

## Optional: Google Play listing
If you later want a Play Store listing, wrap this same site with PWABuilder or Bubblewrap (Trusted Web Activity). Requires a one-time $25 Play developer fee.

## Updating the reference list
`data/styles.js` is generated from the supplied document. Edit entries there (id, name, features, history, where, architects) and redeploy; bump `CACHE` in `sw.js`.

## Local testing
`python3 -m http.server 8000` in this folder, open http://localhost:8000 (camera works on localhost).
