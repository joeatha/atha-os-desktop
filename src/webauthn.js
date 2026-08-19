'use strict';

// Passkeys inside the desktop shell.
//
// Electron ships no macOS platform authenticator by default: `navigator.credentials`
// has nothing to talk to, so a passkey ceremony aborts with no Touch ID prompt ever
// shown and the web app sees "Authentication ceremony was sent an abort signal".
// That is why passkey sign-in never worked in the app — not the RP ID, which was a
// separate (real) blocker fixed in v1.0.3.
//
// Electron 41+ added `app.configureWebAuthn`, which turns on the Secure Enclave
// platform authenticator. Two things are required together, and it fails silently if
// either is missing:
//   1. this call, before the app is ready
//   2. the SAME group in the app's `keychain-access-groups` code-signing entitlement
//      (build/entitlements.mac.plist)
//
// IMPORTANT: credentials live in THIS APP's keychain access group, not in iCloud
// Keychain. A passkey created in a browser is invisible here — a passkey has to be
// registered once inside the app ("Add a passkey" in the profile menu). It is
// device-bound by design: Secure Enclave keys do not sync.

const { app, dialog } = require('electron');
const log = require('electron-log');

// <TEAM_ID>.<BUNDLE_ID>.webauthn — must match build/entitlements.mac.plist exactly.
const KEYCHAIN_ACCESS_GROUP = 'YMHAWA25ZZ.com.athaenterprises.athaos.webauthn';

// macOS renders this as: "Atha OS" is trying to <promptReason>. $1 is the relying
// party of the request, so the prompt names pmione.com rather than being generic.
const PROMPT_REASON = 'sign in to your Atha OS workspace on $1';

// Must run BEFORE app.whenReady().
function configure() {
  if (process.platform !== 'darwin') return false;
  if (typeof app.configureWebAuthn !== 'function') {
    // Electron < 41. The web app feature-detects via
    // isUserVerifyingPlatformAuthenticatorAvailable() and explains itself, so this
    // is a downgrade in capability, not a crash.
    log.warn('webauthn: app.configureWebAuthn unavailable on Electron', process.versions.electron);
    return false;
  }
  try {
    app.configureWebAuthn({
      touchID: { keychainAccessGroup: KEYCHAIN_ACCESS_GROUP, promptReason: PROMPT_REASON },
    });
    log.info('webauthn: Touch ID platform authenticator enabled', KEYCHAIN_ACCESS_GROUP);
    return true;
  } catch (e) {
    log.error('webauthn: configureWebAuthn failed', e && e.message);
    return false;
  }
}

// Account picker. Electron emits this when a ceremony matches more than one
// discoverable credential, and — critically — if nothing answers, or we answer
// without a credential, the request fails with NotAllowedError. So this must be
// registered or multi-credential sign-in breaks.
function attachAccountPicker(session) {
  if (!session || typeof session.on !== 'function') return;

  session.on('select-webauthn-account', async (event, details, callback) => {
    const accounts = (details && details.accounts) || [];
    const rp = (details && details.relyingPartyId) || 'this site';
    log.info(`webauthn: account selection for ${rp} — ${accounts.length} credential(s)`);

    if (accounts.length === 0) {
      callback();                       // cancels as NotAllowedError, which is correct
      return;
    }
    if (accounts.length === 1) {
      callback(accounts[0].credentialId);
      return;
    }

    const labels = accounts.map((a, i) => a.name || a.displayName || `Passkey ${i + 1}`);
    try {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'Choose a passkey',
        message: `Which passkey do you want to use for ${rp}?`,
        buttons: labels.concat(['Cancel']),
        cancelId: labels.length,
        defaultId: 0,
      });
      callback(response < labels.length ? accounts[response].credentialId : undefined);
    } catch (e) {
      log.error('webauthn: account picker failed', e && e.message);
      callback();
    }
  });
}

module.exports = { configure, attachAccountPicker, KEYCHAIN_ACCESS_GROUP };
