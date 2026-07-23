'use strict';

const path = require('path');
const {
  BrowserWindow,
  session,
  shell,
  powerSaveBlocker,
  Notification,
} = require('electron');
const log = require('electron-log');
const {
  APP_URL,
  SESSION_PARTITION,
  UA_TAG,
  isInAppNav,
  isPopupAllowed,
} = require('./config');

let win = null;
let psbId = null; // powerSaveBlocker id

function getWindow() {
  return win;
}

function createWindow() {
  const ses = session.fromPartition(SESSION_PARTITION);

  // Append our tag to the UA so the web app can detect the desktop shell.
  ses.setUserAgent(`${ses.getUserAgent()} ${UA_TAG}`);

  // Mic (+ notifications) permission: the softphone needs audio input. Allow
  // only from our own origin; deny everything else.
  const allowFrom = (url) => {
    try {
      return new URL(url).hostname.endsWith('athaos.netlify.app');
    } catch {
      return false;
    }
  };
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL && wc.getURL()) || '';
    const ok =
      (permission === 'media' || permission === 'notifications') && allowFrom(url);
    log.info('permission request', permission, url, '->', ok);
    cb(ok);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    return (permission === 'media' || permission === 'notifications') && allowFrom(origin);
  });

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Atha OS',
    backgroundColor: '#0f1729',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      partition: SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // CRITICAL: keep timers/WebRTC alive when hidden/minimized so the Twilio
      // Device stays registered and can ring in the background/tray.
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  // Prevent app suspension so the renderer (softphone) isn't throttled when the
  // window is hidden. This is the core reason the desktop app exists.
  startPowerSaveBlocker();

  win.loadURL(APP_URL);

  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });

  wireNavigationLock(win.webContents);

  // Close = hide to tray (configurable via app quit flag set in main.js).
  win.on('close', (e) => {
    if (!global.__athaQuitting) {
      e.preventDefault();
      win.hide();
      if (process.platform === 'darwin' && require('electron').app.dock) {
        // keep dock icon; tray remains the primary control
      }
    }
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

function startPowerSaveBlocker() {
  if (psbId !== null && powerSaveBlocker.isStarted(psbId)) return;
  psbId = powerSaveBlocker.start('prevent-app-suspension');
  log.info('powerSaveBlocker started id=', psbId);
}

function wireNavigationLock(wc) {
  // Top-level navigation: keep our site + OAuth providers in-app; push
  // everything else to the user's real browser.
  wc.on('will-navigate', (e, url) => {
    if (!isInAppNav(url)) {
      e.preventDefault();
      log.info('will-navigate -> external', url);
      shell.openExternal(url);
    }
  });

  // window.open / target=_blank: allow auth popups as controlled child windows;
  // send anything else to the external browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isPopupAllowed(url)) {
      return {
        action: 'allow',
        overrides: {
          webPreferences: {
            partition: SESSION_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Lock down any child windows (OAuth popups) too, and block webviews entirely.
  wc.on('did-create-window', (childWin) => {
    childWin.webContents.on('will-navigate', (e, url) => {
      if (!isInAppNav(url)) {
        e.preventDefault();
        shell.openExternal(url);
      }
    });
    childWin.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

function showWindow() {
  if (!win) createWindow();
  else {
    win.show();
    win.focus();
  }
}

function toggleWindow() {
  if (win && win.isVisible()) win.hide();
  else showWindow();
}

// Surface an incoming call at the OS level even if the window is hidden.
function notifyIncomingCall(info) {
  const from = (info && (info.name || info.from)) || 'Unknown caller';
  log.info('incoming call from', from);

  if (Notification.isSupported()) {
    const n = new Notification({
      title: 'Incoming call — Atha OS',
      body: `${from}\nClick to answer in Atha OS`,
      urgency: 'critical',
    });
    n.on('click', showWindow);
    n.show();
  }

  // Bring the window forward / flash so staff notice.
  if (win) {
    if (process.platform === 'win32' && !win.isFocused()) win.flashFrame(true);
    win.setAlwaysOnTop(true);
    showWindow();
    win.setAlwaysOnTop(false);
  }
}

function stopFlashing() {
  if (win && process.platform === 'win32') win.flashFrame(false);
}

module.exports = {
  createWindow,
  getWindow,
  showWindow,
  toggleWindow,
  notifyIncomingCall,
  stopFlashing,
};
