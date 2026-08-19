'use strict';

const { app, ipcMain } = require('electron');
const log = require('electron-log');
const webauthn = require('./src/webauthn');

log.initialize?.();
log.info('Atha OS desktop starting', app.getVersion());

// Passkeys: must be configured BEFORE the app is ready, so it sits above the
// single-instance branch rather than inside whenReady().
webauthn.configure();

// Single-instance: focus the existing window instead of launching a second copy.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const win = require('./src/window');
  const tray = require('./src/tray');
  const autolaunch = require('./src/autolaunch');
  const updater = require('./src/updater');

  app.on('second-instance', () => win.showWindow());

  app.whenReady().then(() => {
    // macOS dock icon: packaged builds use the .icns, but in dev the dock shows
    // the generic Electron icon — set our branded (black-bg) mark at runtime so
    // it's consistent everywhere.
    if (process.platform === 'darwin' && app.dock) {
      try {
        const path = require('path');
        const { nativeImage } = require('electron');
        const dockIcon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
        if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
      } catch (e) {
        log.warn('dock.setIcon failed', e && e.message);
      }
    }

    // Version sync for preload (synchronous — resolves before page scripts run).
    ipcMain.on('athaos:get-version', (e) => {
      e.returnValue = app.getVersion();
    });

    // Softphone → shell events.
    ipcMain.on('athaos:incoming-call', (_e, info) => win.notifyIncomingCall(info));
    ipcMain.on('athaos:phone-presence', (_e, state) => tray.setPresence(state));
    ipcMain.on('athaos:call-answered', () => win.stopFlashing());

    // Register the passkey account picker on the shared session before any page
    // loads — without a listener a multi-credential ceremony fails NotAllowedError.
    webauthn.attachAccountPicker(require('electron').session.fromPartition(require('./src/config').SESSION_PARTITION));

    win.createWindow();
    tray.createTray();
    autolaunch.init();
    updater.init();

    // macOS: recreate/show window when clicking the dock icon.
    app.on('activate', () => win.showWindow());
  });

  // Do NOT quit when all windows are closed — we live in the tray to keep the
  // softphone registered. Quit only via the tray menu / Cmd-Q (sets the flag).
  app.on('window-all-closed', (e) => {
    if (!global.__athaQuitting) e.preventDefault?.();
  });

  app.on('before-quit', () => {
    global.__athaQuitting = true;
  });
}
