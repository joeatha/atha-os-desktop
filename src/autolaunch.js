'use strict';

const { app } = require('electron');
const log = require('electron-log');
const settings = require('./settings');

// Auto-launch at login uses Electron's built-in login-item support (no extra
// dependency). Default ON — the whole point is to always be running to catch
// queue calls — but the user can toggle it from the tray.

const OPEN_AS_HIDDEN = true; // start in tray, don't steal focus at boot

function isEnabled() {
  try {
    return app.getLoginItemSettings({ args: hiddenArgs() }).openAtLogin;
  } catch (e) {
    log.warn('getLoginItemSettings failed', e);
    return false;
  }
}

function hiddenArgs() {
  return OPEN_AS_HIDDEN ? ['--hidden'] : [];
}

function apply(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: OPEN_AS_HIDDEN, // macOS
      args: hiddenArgs(), // Windows: pass --hidden so we boot into the tray
    });
    settings.set('autoLaunch', enabled);
    log.info('auto-launch set to', enabled);
  } catch (e) {
    log.error('setLoginItemSettings failed', e);
  }
}

// Reconcile OS state with the saved preference on startup (default: enable).
function init() {
  const pref = settings.get('autoLaunch', true);
  if (isEnabled() !== pref) apply(pref);
  return pref;
}

function toggle() {
  const next = !isEnabled();
  apply(next);
  return next;
}

module.exports = { init, isEnabled, apply, toggle };
