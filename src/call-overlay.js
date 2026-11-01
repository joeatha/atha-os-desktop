'use strict';

// Incoming-call pop-up (Atha OS Dev item e48f339f, John C Hagen): a small
// frameless window that floats over everything — every workspace, full-screen
// apps included — centered on the screen the cursor is on, with the caller and
// Answer / Decline. The OS toast and taskbar flash were too easy to miss while
// working in another app (Windows will not let a background app take focus, so
// "bring the window forward" usually only flashes the taskbar).
//
// Local content only: src/call-overlay.html + src/call-overlay-renderer.js,
// sandboxed, with its own two-button bridge (src/call-overlay-preload.js). It
// never touches the logged-in Atha OS session.
//
// It closes when the call is answered (here or in the app), declined, or ends,
// and — as a safety net — when the ring has gone on longer than the page's own
// ring timeout (index.html clears a ring after 120 s without telling the shell).

const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');
const log = require('electron-log');

const WIDTH = 460;
const HEIGHT = 240;
const RING_TIMEOUT_MS = 120000;
const CH = 'athaos:overlay';

let overlayWin = null;
let loaded = false;
let pendingInfo = null;
let ringTimer = null;
let handlers = { onAnswer: () => {}, onDecline: () => {} };
let ipcWired = false;

function init(opts) {
  handlers = {
    onAnswer: (opts && opts.onAnswer) || (() => {}),
    onDecline: (opts && opts.onDecline) || (() => {}),
  };
  if (ipcWired) return;
  ipcWired = true;
  // Only the overlay's own page may press its buttons.
  const fromOverlay = (e) => !!(overlayWin && !overlayWin.isDestroyed() && e && e.sender === overlayWin.webContents);
  ipcMain.on(`${CH}:answer`, (e) => {
    if (!fromOverlay(e)) return;
    log.info('call overlay: Answer');
    close();
    try { handlers.onAnswer(); } catch (err) { log.warn('call overlay answer failed', err && err.message); }
  });
  ipcMain.on(`${CH}:decline`, (e) => {
    if (!fromOverlay(e)) return;
    log.info('call overlay: Decline');
    close();
    try { handlers.onDecline(); } catch (err) { log.warn('call overlay decline failed', err && err.message); }
  });
}

function sanitize(info) {
  info = info || {};
  const clip = (v) => (typeof v === 'string' ? v.slice(0, 120) : undefined);
  return { name: clip(info.name), from: clip(info.from) };
}

// Centered on the work area of the display the cursor is on.
function boundsForCursor() {
  let area = { x: 0, y: 0, width: 1280, height: 800 };
  try {
    area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea || area;
  } catch (e) {
    log.warn('call overlay: no display info', e && e.message);
  }
  return {
    x: area.x + Math.round((area.width - WIDTH) / 2),
    y: area.y + Math.round((area.height - HEIGHT) / 2),
    width: WIDTH,
    height: HEIGHT,
  };
}

function ensureWindow() {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;
  loaded = false;
  overlayWin = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Incoming call',
    backgroundColor: '#0f1729',
    webPreferences: {
      preload: path.join(__dirname, 'call-overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  // Above full-screen apps, and on every workspace / Space.
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const wc = overlayWin.webContents;
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.on('did-finish-load', () => {
    loaded = true;
    if (pendingInfo) present();
  });

  // Alt+F4 / Cmd+W on the pop-up dismisses it (the call keeps ringing in the
  // app); only quitting the app really closes it.
  overlayWin.on('close', (e) => {
    if (!global.__athaQuitting) {
      e.preventDefault();
      close();
    }
  });
  overlayWin.on('closed', () => {
    overlayWin = null;
    loaded = false;
  });

  overlayWin.loadFile(path.join(__dirname, 'call-overlay.html'));
  return overlayWin;
}

function present() {
  if (!overlayWin || overlayWin.isDestroyed() || !pendingInfo) return;
  overlayWin.webContents.send(`${CH}:info`, pendingInfo);
  overlayWin.setBounds(boundsForCursor());
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  // showInactive: pop up without taking the keyboard from whatever the person
  // is typing in, so a stray Enter or space can't answer or decline.
  overlayWin.showInactive();
  overlayWin.moveTop();
}

// Returns true when the pop-up is (or is about to be) on screen, so the caller
// can skip the OS toast; false if it could not be created.
function show(info) {
  try {
    pendingInfo = sanitize(info);
    ensureWindow();
    clearTimeout(ringTimer);
    ringTimer = setTimeout(() => {
      log.info('call overlay: ring timed out');
      close();
    }, RING_TIMEOUT_MS);
    if (loaded) present();
    return true;
  } catch (e) {
    log.warn('call overlay: could not show', e && e.message);
    return false;
  }
}

function close() {
  clearTimeout(ringTimer);
  ringTimer = null;
  pendingInfo = null;
  if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) overlayWin.hide();
}

function isShowing() {
  return !!(overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible());
}

module.exports = { init, show, close, isShowing, RING_TIMEOUT_MS };
