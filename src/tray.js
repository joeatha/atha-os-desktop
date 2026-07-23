'use strict';

const path = require('path');
const { app, Tray, Menu, nativeImage } = require('electron');
const log = require('electron-log');
const win = require('./window');
const autolaunch = require('./autolaunch');
const updater = require('./updater');

let tray = null;
let presence = 'offline'; // 'registered' | 'registering' | 'offline' | 'error'

const PRESENCE_LABEL = {
  registered: '🟢 Phone: registered',
  registering: '🟡 Phone: connecting…',
  offline: '⚪ Phone: offline',
  error: '🔴 Phone: error',
};

function icon(name) {
  return nativeImage.createFromPath(path.join(__dirname, '..', 'assets', name));
}

function createTray() {
  tray = new Tray(icon('tray-idle.png'));
  tray.setToolTip('Atha OS');
  rebuild();

  // Left-click toggles the window (Windows/Linux); macOS shows the menu.
  tray.on('click', () => {
    if (process.platform !== 'darwin') win.toggleWindow();
  });
  return tray;
}

function rebuild() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: PRESENCE_LABEL[presence] || PRESENCE_LABEL.offline, enabled: false },
    { type: 'separator' },
    { label: 'Show Atha OS', click: () => win.showWindow() },
    { label: 'Hide', click: () => { const w = win.getWindow(); if (w) w.hide(); } },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: autolaunch.isEnabled(),
      click: () => { autolaunch.toggle(); rebuild(); },
    },
    { label: 'Check for updates…', click: () => updater.checkForUpdates(true) },
    { type: 'separator' },
    {
      label: 'Quit Atha OS',
      click: () => { global.__athaQuitting = true; app.quit(); },
    },
  ]);
  tray.setContextMenu(menu);
}

function setPresence(state) {
  if (!PRESENCE_LABEL[state]) state = 'offline';
  presence = state;
  if (tray) {
    tray.setImage(icon(state === 'registered' ? 'tray-active.png' : 'tray-idle.png'));
    tray.setToolTip(`Atha OS — ${PRESENCE_LABEL[state].replace(/^[^ ]+ /, '')}`);
    rebuild();
  }
  log.info('phone presence ->', state);
}

module.exports = { createTray, setPresence, rebuild };
