'use strict';

// Central config for the Atha OS desktop shell.

const IS_DEV = process.env.ATHAOS_DEV === '1';

// The live deployed site. The desktop app NEVER bundles index.html — it loads
// this URL so every Netlify web deploy is reflected instantly with no desktop release.
const APP_URL = process.env.ATHAOS_URL || 'https://athaos.netlify.app';

// Persistent session partition so login (Supabase magic-link/Google/passkey)
// and cookies survive restarts.
const SESSION_PARTITION = 'persist:athaos';

// Appended to the User-Agent so the web app can detect it's running inside the
// desktop shell (e.g. to call window.athaDesktop.* or tweak-warn about closing).
const UA_TAG = `AthaOSDesktop/${require('../package.json').version}`;

// --- Navigation policy -------------------------------------------------------
// Top-level (main-frame) navigations allowed to stay INSIDE the window. This
// must include our own site plus the OAuth providers whose redirect flows must
// return to athaos.netlify.app (otherwise sign-in bounces to the system browser
// and breaks). Everything else opens in the user's real browser.
const IN_APP_NAV_HOSTS = [
  'athaos.netlify.app',
  // Supabase auth / data
  '.supabase.co',
  // Google sign-in (OAuth redirect flow)
  'accounts.google.com',
  '.google.com',
  'apis.google.com',
  // Intuit / QuickBooks connect flow
  '.intuit.com',
];

// Popups (window.open / target=_blank) allowed to open as a controlled child
// window instead of being pushed to the external browser — same auth providers.
const POPUP_ALLOW_HOSTS = [
  'athaos.netlify.app',
  '.supabase.co',
  'accounts.google.com',
  '.google.com',
  'apis.google.com',
  '.intuit.com',
];

// Origins the app legitimately talks to via fetch/XHR/WebSocket/WebRTC. NOT
// enforced by navigation locking (Electron doesn't gate subresources on
// will-navigate); documented here and used only for reference/CSP if ever added.
// Twilio Voice SDK: wss://voice-js.*.twilio.com, eventgw.twilio.com, media/TURN.
const KNOWN_API_HOSTS = [
  '.supabase.co',
  '.twilio.com',
  'api.vapi.ai',
  'api.anthropic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

if (IS_DEV) {
  IN_APP_NAV_HOSTS.push('localhost', '127.0.0.1');
  POPUP_ALLOW_HOSTS.push('localhost', '127.0.0.1');
}

function hostMatches(host, patterns) {
  host = (host || '').toLowerCase();
  return patterns.some((p) => {
    if (p.startsWith('.')) return host === p.slice(1) || host.endsWith(p);
    return host === p;
  });
}

function isInAppNav(urlString) {
  try {
    return hostMatches(new URL(urlString).hostname, IN_APP_NAV_HOSTS);
  } catch {
    return false;
  }
}

function isPopupAllowed(urlString) {
  try {
    return hostMatches(new URL(urlString).hostname, POPUP_ALLOW_HOSTS);
  } catch {
    return false;
  }
}

module.exports = {
  IS_DEV,
  APP_URL,
  SESSION_PARTITION,
  UA_TAG,
  IN_APP_NAV_HOSTS,
  POPUP_ALLOW_HOSTS,
  KNOWN_API_HOSTS,
  isInAppNav,
  isPopupAllowed,
};
