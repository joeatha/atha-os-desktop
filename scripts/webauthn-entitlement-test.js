// app.configureWebAuthn produces a NON-WORKING authenticator, with no error, if the
// keychain access group it is given is absent from the app's keychain-access-groups
// entitlement. Nothing at runtime tells you; passkey sign-in just fails. So assert
// the two agree, and that the group matches the <TEAM_ID>.<BUNDLE_ID>.webauthn form
// Electron documents — derived from package.json, not typed twice.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { KEYCHAIN_ACCESS_GROUP } = require('../src/webauthn.js');
const pkg = require('../package.json');

const plistPath = path.join(__dirname, '..', pkg.build.mac.entitlements);
const plist = fs.readFileSync(plistPath, 'utf8');

// The <array> that follows the keychain-access-groups key.
const m = plist.match(/<key>keychain-access-groups<\/key>\s*<array>([\s\S]*?)<\/array>/);
assert.ok(m, `keychain-access-groups missing from ${pkg.build.mac.entitlements}`);
const groups = [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((g) => g[1].trim());

assert.ok(
  groups.includes(KEYCHAIN_ACCESS_GROUP),
  `entitlement does not grant ${KEYCHAIN_ACCESS_GROUP} — passkeys would fail silently. Has: ${groups.join(', ')}`
);

const teamId = pkg.build.mac.notarize.teamId;
const expected = `${teamId}.${pkg.build.appId}.webauthn`;
assert.strictEqual(
  KEYCHAIN_ACCESS_GROUP, expected,
  `group should be <TEAM_ID>.<BUNDLE_ID>.webauthn for this app (${expected})`
);

// Guard the whole feature: the API only exists on Electron 41+.
const major = parseInt(String(pkg.devDependencies.electron).replace(/^[^0-9]*/, ''), 10);
assert.ok(major >= 41, `Electron ${major} has no app.configureWebAuthn — passkeys cannot work in the shell`);

console.log(`PASS — passkey keychain group ${KEYCHAIN_ACCESS_GROUP} granted, Electron ${major}`);
