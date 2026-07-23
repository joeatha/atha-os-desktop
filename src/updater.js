'use strict';

// Auto-update the NATIVE SHELL only (web changes ship via the live Netlify
// site). Feed = GitHub Releases for joeatha/atha-os-desktop (see package.json
// build.publish). electron-updater checks on launch and hourly.

const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');
const log = require('electron-log');

autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let manualCheck = false;
let timer = null;

function init() {
  autoUpdater.on('error', (err) => log.error('updater error', err == null ? 'unknown' : err));
  autoUpdater.on('update-available', (info) => log.info('update available', info.version));
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      dialog.showMessageBox({ type: 'info', message: 'Atha OS is up to date.' });
      manualCheck = false;
    }
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      message: `Atha OS ${info.version} is ready`,
      detail: 'Restart to apply the shell update. (Web features update on their own.)',
    });
    if (response === 0) {
      global.__athaQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });

  // First check shortly after launch, then hourly.
  setTimeout(() => checkForUpdates(false), 10 * 1000);
  timer = setInterval(() => checkForUpdates(false), 60 * 60 * 1000);
}

function checkForUpdates(isManual) {
  manualCheck = isManual;
  autoUpdater.checkForUpdates().catch((e) => log.warn('checkForUpdates failed', e && e.message));
}

module.exports = { init, checkForUpdates };
