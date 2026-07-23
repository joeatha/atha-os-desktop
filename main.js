'use strict';

const { app, ipcMain } = require('electron');
const log = require('electron-log');

log.initialize?.();
log.info('Atha OS desktop starting', app.getVersion());

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
    // Version sync for preload (synchronous — resolves before page scripts run).
    ipcMain.on('athaos:get-version', (e) => {
      e.returnValue = app.getVersion();
    });

    // Softphone → shell events.
    ipcMain.on('athaos:incoming-call', (_e, info) => win.notifyIncomingCall(info));
    ipcMain.on('athaos:phone-presence', (_e, state) => tray.setPresence(state));
    ipcMain.on('athaos:call-answered', () => win.stopFlashing());

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
