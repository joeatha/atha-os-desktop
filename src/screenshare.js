'use strict';

// Screen sharing (getDisplayMedia) support for in-app meetings — Google Meet,
// Zoom web, etc.
//
// Two separate gates have to be opened before "Present now" works:
//
//   1. CHROMIUM: since Electron 17, `navigator.mediaDevices.getDisplayMedia()`
//      rejects unless the app installs a `setDisplayMediaRequestHandler`. There
//      is no built-in source picker, so we render our own (screens + windows).
//      `display-capture` also has to be granted in the permission handler
//      (see src/window.js).
//   2. THE OS: macOS gates screen capture behind the Screen Recording TCC
//      permission, which — unlike mic/camera — has NO `askForMediaAccess()` API.
//      The prompt only appears when capture is first attempted, and the grant
//      does not apply to a running process, so the app must be relaunched.
//      Windows needs nothing here.
//
// NB: macOS 15+ has a native system picker (`{ useSystemPicker: true }`), but
// it is still flagged experimental in Electron 33 and unavailable on macOS 14,
// so we use our own picker everywhere for one predictable behaviour.

const path = require('path');
const {
  BrowserWindow,
  app,
  desktopCapturer,
  dialog,
  ipcMain,
  shell,
  systemPreferences,
} = require('electron');
const log = require('electron-log');

const PICKER_CHANNEL = 'athaos:picker';

let pickerWin = null;

// --- macOS Screen Recording permission ---------------------------------------

function screenAccessStatus() {
  if (process.platform !== 'darwin') return 'granted';
  try {
    return systemPreferences.getMediaAccessStatus('screen');
  } catch (e) {
    log.warn('getMediaAccessStatus(screen) failed', e && e.message);
    return 'unknown';
  }
}

// Returns true if we're allowed to capture. On the first attempt this pokes
// ScreenCaptureKit (via getSources) so macOS shows its own prompt, then guides
// the user to System Settings if it's still blocked.
async function ensureScreenAccess(parent) {
  if (process.platform !== 'darwin') return true;

  let status = screenAccessStatus();
  log.info('OS screen-recording status', status);
  if (status === 'granted') return true;

  // Touching the capture API is the only way to trigger the native TCC prompt.
  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
  } catch (e) {
    log.warn('screen access probe failed', e && e.message);
  }

  status = screenAccessStatus();
  if (status === 'granted') return true;

  const { response } = await dialog.showMessageBox(parent || null, {
    type: 'warning',
    title: 'Allow screen recording',
    message: 'macOS is blocking screen sharing for Atha OS.',
    detail:
      'Open System Settings → Privacy & Security → Screen & System Audio Recording ' +
      'and turn on Atha OS. macOS only applies the change after the app restarts, ' +
      'so reopen Atha OS and then share your screen again.',
    buttons: ['Open System Settings', 'Restart Atha OS', 'Later'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (response === 0) {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    );
  } else if (response === 1) {
    global.__athaQuitting = true;
    app.relaunch();
    app.quit();
  }
  return false;
}

// --- Source picker -----------------------------------------------------------

async function listSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });
  // Never offer our own picker window as something to share.
  return sources.filter((s) => s.name !== 'Atha OS — Choose what to share');
}

function serialize(sources) {
  return sources.map((s) => ({
    id: s.id,
    name: s.name || 'Untitled',
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
    appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
  }));
}

// Opens the picker and resolves with the chosen source id, or null if cancelled.
function showPicker(parent, sources) {
  return new Promise((resolve) => {
    if (pickerWin) {
      pickerWin.focus();
      return resolve(null);
    }

    let settled = false;
    const finish = (id) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler(`${PICKER_CHANNEL}:sources`);
      ipcMain.removeAllListeners(`${PICKER_CHANNEL}:choose`);
      if (pickerWin && !pickerWin.isDestroyed()) pickerWin.destroy();
      pickerWin = null;
      resolve(id);
    };

    ipcMain.handle(`${PICKER_CHANNEL}:sources`, () => serialize(sources));
    ipcMain.on(`${PICKER_CHANNEL}:choose`, (_e, id) => finish(id || null));

    pickerWin = new BrowserWindow({
      parent: parent || undefined,
      modal: Boolean(parent),
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Atha OS — Choose what to share',
      backgroundColor: '#0f1729',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    pickerWin.loadFile(path.join(__dirname, 'picker.html'));
    pickerWin.once('ready-to-show', () => pickerWin.show());
    pickerWin.on('closed', () => finish(null));
  });
}

// --- Wiring ------------------------------------------------------------------

function init(ses, getParentWindow) {
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const parent = (getParentWindow && getParentWindow()) || null;
    log.info('display-media request from', request.securityOrigin, {
      video: request.videoRequested,
      audio: request.audioRequested,
    });

    try {
      if (!(await ensureScreenAccess(parent))) return callback({});

      const sources = await listSources();
      if (!sources.length) {
        log.warn('no capture sources available');
        return callback({});
      }

      const chosenId = await showPicker(parent, sources);
      if (!chosenId) {
        log.info('screen share cancelled by user');
        return callback({});
      }

      const source = sources.find((s) => s.id === chosenId);
      if (!source) return callback({});

      log.info('sharing source', source.id, source.name);
      const streams = { video: source };
      // System audio capture is Windows-only in Electron; macOS shares video only.
      if (request.audioRequested && process.platform === 'win32') {
        streams.audio = 'loopback';
      }
      callback(streams);
    } catch (e) {
      log.error('display-media request failed', e && e.message);
      callback({});
    }
  });
}

module.exports = { init, screenAccessStatus };
