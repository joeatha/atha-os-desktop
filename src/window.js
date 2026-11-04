'use strict';

const path = require('path');
const {
  BrowserWindow,
  session,
  shell,
  powerSaveBlocker,
  Notification,
  systemPreferences,
  dialog,
  Menu,
} = require('electron');
const log = require('electron-log');
const {
  APP_URL,
  SESSION_PARTITION,
  UA_TAG,
  isInAppNav,
  isPopupAllowed,
  isPermissionAllowed,
} = require('./config');
const screenshare = require('./screenshare');
const { wireContextMenu } = require('./context-menu');
const callOverlay = require('./call-overlay');

let win = null;
let psbId = null; // powerSaveBlocker id

function getWindow() {
  return win;
}

function createWindow() {
  const ses = session.fromPartition(SESSION_PARTITION);

  // Append our tag to the UA so the web app can detect the desktop shell.
  ses.setUserAgent(`${ses.getUserAgent()} ${UA_TAG}`);

  // Camera/mic/screen (+ notifications) permission: the softphone needs audio
  // input, and video meetings joined in-app (Google Meet) need camera + mic, plus
  // `display-capture` to present a screen. Allow only from our own origin and
  // trusted meeting hosts; deny everything else, except full screen, which any
  // video player may ask for. (MEDIA_HOSTS and the rule live in config.js.)
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL && wc.getURL()) || '';
    const ok = isPermissionAllowed(permission, url);
    log.info('permission request', permission, url, '->', ok);
    // The app-level grant above lets Chromium hand the stream to the page, but the
    // OS still gates the hardware. Make sure the OS prompt/guidance actually shows.
    if (ok && permission === 'media') ensureOsMediaAccess();
    cb(ok);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => isPermissionAllowed(permission, origin));

  // getDisplayMedia() is rejected outright unless the app installs a handler —
  // this is what makes "Present now" work in an in-app Google Meet.
  screenshare.init(ses, getWindow);

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
  // Incoming-call pop-up over everything (src/call-overlay.js). Its buttons take
  // the same paths as the toast: Answer → the page answers; Decline → the page
  // declines (index.html registers athaDesktop.onDeclineRequested).
  callOverlay.init({ onAnswer: answerFromToast, onDecline: declineFromOverlay });
  // The page reloading or crashing ends any ringing call with it.
  win.webContents.on('did-navigate', () => callOverlay.close());
  win.webContents.on('render-process-gone', () => callOverlay.close());
  // Right-click: spelling suggestions + Cut/Copy/Paste (src/context-menu.js).
  wireContextMenu(win.webContents, { Menu, getWindow: () => win });

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

// Make sure the *operating system* will let us reach the mic/camera. Electron's
// permission handler only governs the Chromium layer — the OS is a second gate.
//   • macOS: trigger the native TCC prompt up-front the first time (persistent
//     once answered; needs the usage-description strings + camera entitlement).
//   • Windows: Win32 apps are NEVER prompted by the OS. If the global
//     "let desktop apps access your camera/microphone" toggle is off, access
//     silently fails — so surface an in-app dialog that opens the right Settings
//     page. Guard so we ask at most once per type per session.
const _osMediaAsked = new Set();
async function ensureOsMediaAccess() {
  for (const type of ['microphone', 'camera']) {
    if (_osMediaAsked.has(type)) continue;
    try {
      const status = systemPreferences.getMediaAccessStatus(type);
      log.info('OS media status', type, status);
      if (status === 'granted') { _osMediaAsked.add(type); continue; }

      if (process.platform === 'darwin') {
        if (status === 'not-determined') {
          _osMediaAsked.add(type);
          const granted = await systemPreferences.askForMediaAccess(type);
          log.info('macOS askForMediaAccess', type, '->', granted);
        }
        // 'denied'/'restricted' can only be changed by the user in System Settings.
      } else if (process.platform === 'win32' && status === 'denied') {
        _osMediaAsked.add(type);
        const isCam = type === 'camera';
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          title: `Allow ${type} access`,
          message: `Windows is blocking ${type} access for desktop apps.`,
          detail:
            `Open Settings → Privacy & security → ${isCam ? 'Camera' : 'Microphone'} ` +
            `and turn on “Let desktop apps access your ${type}.” Then rejoin the meeting.`,
          buttons: ['Open Windows Settings', 'Later'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (response === 0) shell.openExternal(isCam ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone');
      }
    } catch (e) {
      log.warn('ensureOsMediaAccess failed', type, e && e.message);
    }
  }
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

  // Already looking at Atha OS → the in-app call bar IS the notice. A critical
  // OS toast would only land on top of the bar's Answer button, so staff click
  // the toast instead of answering (Atha OS Dev item 2d203bdf).
  const inFront = !!(win && !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.isMinimized());

  // Not looking at Atha OS → pop the call up over everything, centered on the
  // screen the cursor is on, with Answer / Decline (Atha OS Dev e48f339f: the
  // toast and taskbar flash were too easy to miss in another app). The pop-up
  // replaces the toast; the toast is the fallback if it can't be shown.
  let popped = false;
  if (!inFront) {
    try {
      popped = !!callOverlay.show(info);
    } catch (e) {
      log.warn('call overlay failed', e && e.message);
    }
  }

  if (!inFront && !popped && Notification.isSupported()) {
    const n = new Notification({
      title: 'Incoming call — Atha OS',
      body: `${from}\nClick to answer in Atha OS`,
      urgency: 'critical',
    });
    n.on('click', answerFromToast);
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

// The toast says "Click to answer" — so a click must ANSWER, not just raise the
// window. It used to call showWindow() only: the call kept ringing while the
// agent believed they had answered, and it rang out (Atha OS Dev 5ce38cc7,
// "It ended the call when I hit Answer"). The page decides whether a call is
// actually still ringing; this only asks.
function answerFromToast() {
  log.info('incoming-call toast clicked → asking the page to answer');
  showWindow();
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send('athaos:answer-call');
}

// Decline on the pop-up → ask the page to decline the ringing call. The page
// decides whether one is still ringing. A page that hasn't registered
// onDeclineRequested yet ignores this, so the call keeps ringing in the app
// (the pop-up still closes).
function declineFromOverlay() {
  log.info('incoming-call pop-up Decline → asking the page to decline');
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send('athaos:decline-call');
}

function stopFlashing() {
  if (win && process.platform === 'win32') win.flashFrame(false);
}

// The page calls athaDesktop.callAnswered() when a call is answered AND when a
// ring ends (cancel / reject / disconnect / error) — stop the flash and take
// the pop-up down either way.
function ringEnded() {
  stopFlashing();
  callOverlay.close();
}

module.exports = {
  createWindow,
  getWindow,
  showWindow,
  toggleWindow,
  notifyIncomingCall,
  answerFromToast,
  declineFromOverlay,
  stopFlashing,
  ringEnded,
};
