# Atha OS Desktop

A thin **Electron** shell that runs Atha OS as an always-on desktop app for macOS and Windows.

## Why this exists

Atha OS includes a **softphone** (Twilio Voice JS SDK, identity `client:<user-email>`) that must stay registered to receive inbound call-queue calls. In a browser tab it de-registers whenever the tab is closed, backgrounded, or suspended — and queue calls get **missed** ("Atha OS not open" in the Call Log). This app keeps the softphone alive in the background/tray so calls aren't missed, pushing toward our 90%+ answer-rate goal.

## The maintenance model (important)

- **The app loads the LIVE site** `https://athaos.netlify.app` — it does **not** bundle a copy of `index.html`.
- **Web changes ship automatically.** Every Netlify deploy is reflected in the desktop app on next load. No desktop release needed.
- **You only cut a desktop release when the native shell changes** (`main.js`, `preload.js`, `src/*`, packaging, permissions).

## What the shell does

- Single window → live site, with a **persistent session** (`persist:athaos`) so Supabase magic-link / Google / passkey login survives restarts.
- **Background presence:** `powerSaveBlocker('prevent-app-suspension')` + `backgroundThrottling: false`. Closing the window **hides to the tray** (quit only via tray menu / Cmd-Q).
- **System tray:** show/hide, live phone-presence indicator (icon turns green when registered), start-at-login toggle, check-for-updates, quit.
- **Auto-launch at login** (default ON, toggleable), booting hidden into the tray.
- **Microphone permission** handled for our origin (+ macOS `NSMicrophoneUsageDescription`). The web app's in-app mic picker (incl. "System Default") keeps working.
- **Incoming-call notification:** native OS notification + window focus/flash when a call rings.
- **Auto-update** (`electron-updater`) from GitHub Releases — shell updates only.

### Security posture (this loads a remote URL)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The remote page gets **no Node access** — only a tiny `window.athaDesktop` bridge (`preload.js`).
- Top-level navigation is locked to our site + OAuth providers (Supabase / Google / Intuit); everything else opens in the user's real browser via `shell.openExternal`. Auth popups open as controlled child windows; other popups are externalized. Webviews are blocked. See `src/config.js`.

### Web-side integration hooks (optional, zero-coupling)

The web app can detect and drive the shell:

```js
if (window.athaDesktop?.isDesktop) {
  window.athaDesktop.setPhonePresence('registered');      // tray goes green
  window.athaDesktop.incomingCall({ from: '+1217…', name: 'Jane' }); // native notif + focus
}
// Or via DOM events (no bridge dependency):
window.dispatchEvent(new CustomEvent('athaos:incoming-call', { detail: { from } }));
window.dispatchEvent(new CustomEvent('athaos:phone-presence', { detail: 'registered' }));
```

The shell also appends `AthaOSDesktop/<version>` to the User-Agent for detection. These are **optional** — the app works without any web changes; wiring them just makes the tray indicator and background notifications richer.

## Develop

```bash
npm install
npm start          # loads the live site
npm run dev        # dev mode (also allows localhost origins)
npm run check      # node --check on all source files (no GUI)
```

Point the shell at a different URL for testing: `ATHAOS_URL=http://localhost:8888 npm run dev`.

## Build

```bash
npm run dist:mac   # dmg + zip (arm64 + x64) in dist/
npm run dist:win   # nsis installer (x64) in dist/  — unsigned until a cert exists
```

## Release (auto-update)

Releases publish to GitHub Releases at `joeatha/atha-os-desktop` (see `package.json > build.publish`).

```bash
export GH_TOKEN=…            # repo-scoped token (or in .env)
npm run release             # builds + publishes; electron-updater picks it up
```

Bump `version` in `package.json` before each shell release.

---

## Signing & notarization

### macOS — Developer ID Application + notarization

You have an Apple Developer account but need to generate the cert. **Steps only you can do:**

1. **Generate the certificate** (type = *Developer ID Application* — this is for apps distributed **outside** the Mac App Store, which a `.dmg`/`.app` is; **not** "Mac App Distribution"):
   - Xcode → Settings → Accounts → your Team → **Manage Certificates** → **+** → **Developer ID Application**. This creates the cert + private key in your login keychain.
   - Or via the portal: https://developer.apple.com/account/resources/certificates → **+** → *Developer ID Application* → upload a CSR from Keychain Access (*Certificate Assistant → Request a Certificate from a Certificate Authority*), download the `.cer`, double-click to install.
2. **Find your Team ID:** https://developer.apple.com/account → Membership (10 chars). Put it in `package.json` → `build.mac.notarize` (see below).
3. **Create an App Store Connect API key for notarization** (preferred over app-specific password):
   - https://appstoreconnect.apple.com/access/integrations/api → **+** → Access: *Developer* → download the `AuthKey_XXXX.p8` (one-time download). Note the **Key ID** and **Issuer ID**.
   - Put the `.p8` in `build/` (gitignored) and set `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (see `.env.example`).

**Then flip on notarization** in `package.json`:

```jsonc
"mac": {
  "notarize": { "teamId": "YOURTEAMID" }   // was false
}
```

electron-builder already: uses the **hardened runtime**, applies `build/entitlements.mac.plist` (includes `com.apple.security.device.audio-input` for the mic), and will notarize via `notarytool` using the API-key env vars. Verify a finished build with:

```bash
spctl -a -vvv --type exec "dist/mac-arm64/Atha OS.app"   # should say: accepted / Notarized Developer ID
```

### Windows — code signing (STUBBED, no cert yet)

Windows builds ship **unsigned** for now (users get a one-time SmartScreen "More info → Run anyway" warning). To remove it, **buy a code-signing certificate**:

- **OV** (Organization Validation) — cheaper, but SmartScreen reputation must build up over downloads.
- **EV** (Extended Validation) — instant SmartScreen reputation, but **requires a hardware token or cloud HSM** (newer OV certs increasingly do too).
- CAs: DigiCert, Sectigo, GlobalSign, SSL.com, etc.

Once acquired, wire it via env vars (see `.env.example`): `CSC_LINK` (path to `.pfx`) + `CSC_KEY_PASSWORD`, or configure the CA's cloud-signing tool. No code change needed beyond that.

## Icons

`build/icon.png` (512×512) and `assets/tray-*.png` are **placeholders**. Replace with real branded artwork before shipping publicly — electron-builder auto-generates `.icns`/`.ico` from `build/icon.png`.
