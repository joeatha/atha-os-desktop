// Proves the desktop shell loads an origin whose domain the Supabase WebAuthn
// RP ID ("pmione.com") is valid for, and that the domain stays in-app.
const assert = require('assert');
const cfg = require('../src/config.js');
const RP_ID = 'pmione.com';                       // Supabase GoTrue WebAuthn RP ID

const host = new URL(cfg.APP_URL).hostname;
// WebAuthn: rpId must equal the caller's domain or be a registrable parent of it.
assert.ok(host === RP_ID || host.endsWith('.' + RP_ID),
  `APP_URL host "${host}" cannot use RP ID "${RP_ID}" — passkeys will fail`);

assert.ok(cfg.isInAppNav(cfg.APP_URL), 'APP_URL must be allowed to load in-app');
assert.ok(cfg.isInAppNav('https://pmione.com/login.html'), 'login page must stay in-app');
assert.ok(cfg.isInAppNav('https://athaos.netlify.app/'), 'legacy host must stay in-app');
assert.ok(cfg.isPopupAllowed('https://pmione.com/'), 'own-site popups must stay in-app');
assert.ok(cfg.isInAppNav('https://accounts.google.com/o/oauth2/v2/auth'), 'Google OAuth must stay in-app');
assert.ok(!cfg.isInAppNav('https://evil.example/'), 'foreign hosts must be ejected');
assert.ok(!cfg.isInAppNav('https://notpmione.com/'), 'suffix-lookalike must not match');
assert.ok(cfg.MEDIA_HOSTS.includes('pmione.com'), 'softphone origin needs mic/camera');

console.log(`PASS — shell loads ${cfg.APP_URL}, RP ID "${RP_ID}" is valid there`);
