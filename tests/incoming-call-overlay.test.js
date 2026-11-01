// Incoming calls get a pop-up over everything (Atha OS Dev item e48f339f,
// John C Hagen): a small frameless, always-on-top window centered on the
// screen the cursor is on, on every workspace, with the caller and Answer /
// Decline. It closes when the call is answered, ends or is declined, or when
// the ring stops. Answer takes the same path as the toast click
// ('athaos:answer-call'); Decline asks the page over 'athaos:decline-call'.
//
//   node tests/incoming-call-overlay.test.js
//
// Hermetic: loads the real src/call-overlay.js, src/window.js and the two
// preloads against a stubbed `electron` module. No GUI, no network.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
for (const f of ['src/call-overlay.js', 'src/call-overlay-preload.js', 'src/call-overlay.html', 'src/call-overlay-renderer.js']) {
  assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
}

// ── stub electron ────────────────────────────────────────────────────────────
const ipcHandlers = {};
const created = [];
let cursor = { x: 2500, y: 300 };
const displays = [
  { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];
class FakeWC {
  constructor() { this.sent = []; this.handlers = {}; this.openHandler = null; }
  send(ch, ...a) { this.sent.push([ch, ...a]); }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  once(ev, fn) { this.on(ev, fn); }
  setWindowOpenHandler(fn) { this.openHandler = fn; }
  isLoading() { return false; }
}
class BrowserWindow {
  constructor(opts) {
    this.opts = opts; this.webContents = new FakeWC(); this.handlers = {};
    this.visible = false; this.destroyed = false; this.calls = []; this.loaded = null;
    created.push(this);
  }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  once(ev, fn) { this.on(ev, fn); }
  emit(ev, ...a) { (this.handlers[ev] || []).forEach((fn) => fn(...a)); }
  loadFile(p) { this.loaded = p; }
  loadURL(u) { this.loadedURL = u; }
  setAlwaysOnTop(...a) { this.calls.push(['setAlwaysOnTop', ...a]); }
  setVisibleOnAllWorkspaces(...a) { this.calls.push(['setVisibleOnAllWorkspaces', ...a]); }
  setBounds(b) { this.bounds = b; }
  showInactive() { this.visible = true; this.calls.push(['showInactive']); }
  show() { this.visible = true; this.calls.push(['show']); }
  hide() { this.visible = false; this.calls.push(['hide']); }
  moveTop() { this.calls.push(['moveTop']); }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  isFocused() { return false; }
  isMinimized() { return false; }
  flashFrame(v) { this.calls.push(['flashFrame', v]); }
  focus() {}
}
const electron = {
  BrowserWindow,
  screen: {
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: (pt) => displays.find((d) => pt.x >= d.workArea.x && pt.x < d.workArea.x + d.workArea.width) || displays[0],
  },
  ipcMain: { on: (ch, fn) => { (ipcHandlers[ch] = ipcHandlers[ch] || []).push(fn); } },
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return electron;
  if (req === 'electron-log') return { info() {}, warn() {}, error() {} };
  return origLoad.apply(this, arguments);
};

// Fake timers so the ring safety net can be exercised without waiting.
const timers = [];
global.setTimeout = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; };
global.clearTimeout = (t) => { if (t) t.cleared = true; };
const fireTimers = () => timers.splice(0).forEach((t) => { if (!t.cleared) t.fn(); });

const overlay = require(path.join(ROOT, 'src', 'call-overlay.js'));
const ipc = (ch, sender, ...a) => (ipcHandlers[ch] || []).forEach((fn) => fn({ sender }, ...a));

// ── 1. show() builds a locked-down, always-on-top, frameless local window ───
let answered = 0, declined = 0;
overlay.init({ onAnswer: () => { answered++; }, onDecline: () => { declined++; } });
assert.strictEqual(overlay.show({ name: 'Jane Resident', from: '+13175551234' }), true, 'show() reports it showed');
assert.strictEqual(created.length, 1, 'one overlay window');
const ow = created[0];
const fireLoad = (w) => (w.webContents.handlers['did-finish-load'] || []).forEach((fn) => fn());
assert.ok(!ow.visible, 'not shown before the local page has loaded (no blank card)');
fireLoad(ow);
const o = ow.opts;
assert.strictEqual(o.frame, false, 'frameless');
assert.strictEqual(o.alwaysOnTop, true, 'always on top');
assert.strictEqual(o.skipTaskbar, true, 'no extra taskbar button');
assert.strictEqual(o.resizable, false, 'not resizable');
assert.strictEqual(o.show, false, 'created hidden, shown once laid out');
assert.strictEqual(o.webPreferences.contextIsolation, true, 'contextIsolation');
assert.strictEqual(o.webPreferences.nodeIntegration, false, 'no node');
assert.strictEqual(o.webPreferences.sandbox, true, 'sandboxed');
assert.strictEqual(path.basename(o.webPreferences.preload), 'call-overlay-preload.js', 'its own tiny preload');
assert.ok(!o.webPreferences.partition, 'not in the logged-in Atha OS session');
assert.strictEqual(path.basename(ow.loaded || ''), 'call-overlay.html', 'loads the local HTML file');
assert.ok(!ow.loadedURL, 'never loads a URL');
assert.ok(ow.calls.some((c) => c[0] === 'setAlwaysOnTop' && c[1] === true && c[2] === 'screen-saver'), 'floats above full-screen apps');
assert.ok(ow.calls.some((c) => c[0] === 'setVisibleOnAllWorkspaces' && c[1] === true && c[2] && c[2].visibleOnFullScreen === true), 'on every workspace');
assert.ok(ow.calls.some((c) => c[0] === 'showInactive'), 'shown without stealing the keyboard');
assert.ok(ow.visible, 'visible');
// Centered on the display the cursor is on (display 2).
const b = ow.bounds;
assert.ok(b, 'bounds set');
assert.strictEqual(b.x, 1920 + Math.round((2560 - b.width) / 2), 'centered horizontally on the cursor display');
assert.strictEqual(b.y, Math.round((1400 - b.height) / 2), 'centered vertically on the cursor display');
// Caller info goes to the overlay, sanitized.
const infoMsgs = () => ow.webContents.sent.filter((s) => s[0] === 'athaos:overlay:info');
assert.deepStrictEqual(infoMsgs().pop()[1], { name: 'Jane Resident', from: '+13175551234' }, 'caller info sent to the overlay');
// Navigation and pop-ups are locked.
let prevented = false;
(ow.webContents.handlers['will-navigate'] || []).forEach((fn) => fn({ preventDefault: () => { prevented = true; } }, 'https://evil.example'));
assert.ok(prevented, 'overlay cannot navigate');
assert.deepStrictEqual(ow.webContents.openHandler({ url: 'https://x' }), { action: 'deny' }, 'overlay cannot open windows');

// ── 2. IPC from anyone but the overlay is ignored ────────────────────────────
ipc('athaos:overlay:answer', new FakeWC());
ipc('athaos:overlay:decline', new FakeWC());
assert.strictEqual(answered + declined, 0, 'a foreign sender cannot answer or decline');

// ── 3. Answer → onAnswer, overlay closes ─────────────────────────────────────
ipc('athaos:overlay:answer', ow.webContents);
assert.strictEqual(answered, 1, 'Answer runs the answer path');
assert.strictEqual(ow.visible, false, 'overlay closes on Answer');

// ── 4. a second ring reuses the window and refreshes the caller ──────────────
overlay.show({ name: '🚨 EMERGENCY – Bob', from: '+13175550000' });
assert.strictEqual(created.length, 1, 'window reused');
assert.ok(ow.visible, 'visible again');
assert.deepStrictEqual(infoMsgs().pop()[1], { name: '🚨 EMERGENCY – Bob', from: '+13175550000' }, 'new caller shown');
ipc('athaos:overlay:decline', ow.webContents);
assert.strictEqual(declined, 1, 'Decline runs the decline path');
assert.strictEqual(ow.visible, false, 'overlay closes on Decline');

// ── 5. close() (ring ended / answered in the app) hides it ───────────────────
overlay.show({ from: '+13175551111' });
overlay.close();
assert.strictEqual(ow.visible, false, 'close() hides the overlay');
assert.strictEqual(answered + declined, 2, 'close() answers/declines nothing');

// ── 6. safety net: an unanswered ring that never reports ending still closes ─
timers.length = 0;
overlay.show({ from: '+13175552222' });
const ringTimer = timers.find((t) => !t.cleared);
assert.ok(ringTimer && ringTimer.ms >= 60000 && ringTimer.ms <= 180000, 'a ring timeout is armed');
fireTimers();
assert.strictEqual(ow.visible, false, 'overlay closes when the ring times out');

// ── 7. sanitize: strings only, clipped ───────────────────────────────────────
overlay.show({ name: 'x'.repeat(500), from: { evil: 1 }, html: '<img>' });
assert.deepStrictEqual(infoMsgs().pop()[1], { name: 'x'.repeat(120), from: undefined }, 'only clipped strings reach the overlay');
overlay.close();

// ── 8. destroyed window is rebuilt on the next ring ──────────────────────────
ow.destroyed = true; ow.emit('closed');
overlay.show({ from: '+13175553333' });
assert.strictEqual(created.length, 2, 'a fresh overlay after the old one was destroyed');
fireLoad(created[1]);
assert.ok(created[1].visible, 'the fresh overlay shows once loaded');
overlay.close();

// ── 9. window.js wires it: overlay replaces the toast; toast is the fallback ─
const winSrc = read('src/window.js');
function extract(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in src/window.js`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
function runWindow({ overlayShows, inFront }) {
  const toasts = [], sent = [], ov = { shown: [], closed: 0 };
  let shownMain = 0;
  class Notification { static isSupported() { return true; } constructor(x) { this.x = x; } on() {} show() { toasts.push(this.x); } }
  const win = {
    isDestroyed: () => false, isVisible: () => inFront, isFocused: () => inFront, isMinimized: () => false,
    flashFrame() {}, setAlwaysOnTop() {},
    webContents: { send: (ch, ...a) => sent.push([ch, ...a]) },
  };
  const callOverlay = { show: (i) => { ov.shown.push(i); return overlayShows; }, close: () => { ov.closed++; } };
  // eslint-disable-next-line no-new-func
  const api = new Function('Notification', 'log', 'win', 'showWindow', 'process', 'callOverlay',
    ['notifyIncomingCall', 'answerFromToast', 'declineFromOverlay', 'stopFlashing', 'ringEnded'].map((n) => extract(winSrc, n)).join('\n') +
    '\nreturn { notifyIncomingCall, answerFromToast, declineFromOverlay, ringEnded };')(
    Notification, { info() {}, warn() {} }, win, () => { shownMain++; }, { platform: 'win32' }, callOverlay);
  return { api, toasts, sent, ov, shownMain: () => shownMain };
}
let r = runWindow({ overlayShows: true, inFront: false });
r.api.notifyIncomingCall({ from: '+13175551234', name: 'Jane' });
assert.deepStrictEqual(r.ov.shown, [{ from: '+13175551234', name: 'Jane' }], 'window behind → overlay with the caller');
assert.strictEqual(r.toasts.length, 0, 'overlay shown → no duplicate toast');
r = runWindow({ overlayShows: false, inFront: false });
r.api.notifyIncomingCall({ from: '+13175551234' });
assert.strictEqual(r.toasts.length, 1, 'overlay unavailable → the toast still shows');
r = runWindow({ overlayShows: true, inFront: true });
r.api.notifyIncomingCall({ from: '+13175551234' });
assert.strictEqual(r.ov.shown.length + r.toasts.length, 0, 'window in front → the in-app call bar is the notice');
r = runWindow({ overlayShows: true, inFront: false });
r.api.ringEnded();
assert.strictEqual(r.ov.closed, 1, 'ring ended / answered in the app → overlay closes');
r.api.declineFromOverlay();
assert.deepStrictEqual(r.sent, [['athaos:decline-call']], 'Decline asks the page to decline (nothing else crosses)');
r.sent.length = 0;
r.api.answerFromToast();
assert.deepStrictEqual(r.sent, [['athaos:answer-call']], 'Answer uses the same answer path as the toast');
assert.ok(/callOverlay\.init\(\s*\{\s*onAnswer:\s*answerFromToast,\s*onDecline:\s*declineFromOverlay/.test(winSrc), 'overlay buttons wired to answerFromToast / declineFromOverlay');

// main.js: the page's callAnswered() (sent on answer AND on cancel/reject/disconnect) ends the ring.
const mainSrc = read('main.js');
assert.ok(/'athaos:call-answered',\s*\(\)\s*=>\s*win\.ringEnded\(\)/.test(mainSrc), "main.js: 'athaos:call-answered' → win.ringEnded()");

// ── 10. main-window preload exposes onDeclineRequested (no args to the page) ─
const preSrc = read('preload.js');
let exposed = null; const listeners = {};
const fakeElectron = {
  contextBridge: { exposeInMainWorld: (k, v) => { if (k === 'athaDesktop') exposed = v; } },
  ipcRenderer: { sendSync: () => '1.0.6', send() {}, on: (ch, fn) => { (listeners[ch] = listeners[ch] || []).push(fn); } },
};
// eslint-disable-next-line no-new-func
new Function('require', 'window', preSrc)(() => fakeElectron, { addEventListener() {} });
assert.strictEqual(typeof exposed.onDeclineRequested, 'function', 'bridge exposes onDeclineRequested');
exposed.onDeclineRequested(42);
assert.ok(!listeners['athaos:decline-call'], 'non-function callback registers nothing');
const got = [];
exposed.onDeclineRequested((...a) => got.push(a));
listeners['athaos:decline-call'][0]({ sender: 'IPC-EVENT' }, 'extra');
assert.deepStrictEqual(got, [[]], 'page decline callback gets NO args');
exposed.onDeclineRequested(() => { throw new Error('page bug'); });
assert.doesNotThrow(() => listeners['athaos:decline-call'][1]({}), 'throwing page callback is contained');

// ── 11. overlay preload + page: tiny bridge, no remote content, no innerHTML ─
const opSrc = read('src/call-overlay-preload.js');
let ovExposed = null; const ovSent = []; const ovListeners = {};
// eslint-disable-next-line no-new-func
new Function('require', opSrc)(() => ({
  contextBridge: { exposeInMainWorld: (k, v) => { if (k === 'athaCallOverlay') ovExposed = v; } },
  ipcRenderer: { send: (ch, ...a) => ovSent.push([ch, ...a]), on: (ch, fn) => { (ovListeners[ch] = ovListeners[ch] || []).push(fn); } },
}));
assert.deepStrictEqual(Object.keys(ovExposed).sort(), ['answer', 'decline', 'onInfo'], 'overlay bridge: answer, decline, onInfo only');
ovExposed.answer('ignored'); ovExposed.decline('ignored');
assert.deepStrictEqual(ovSent, [['athaos:overlay:answer'], ['athaos:overlay:decline']], 'buttons send bare messages');
const infos = [];
ovExposed.onInfo((i) => infos.push(i));
ovListeners['athaos:overlay:info'][0]({ sender: 'IPC-EVENT' }, { name: 'A', from: 'B' });
assert.deepStrictEqual(infos, [{ name: 'A', from: 'B' }], 'onInfo passes the info, never the IPC event');

const html = read('src/call-overlay.html');
const rend = read('src/call-overlay-renderer.js');
assert.ok(/Content-Security-Policy[^>]*default-src 'none'/.test(html), 'strict CSP');
assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')) && !/https?:\/\//.test(rend), 'no remote content in the overlay');
assert.ok(/id="answer"/.test(html) && /id="decline"/.test(html), 'Answer and Decline buttons');
assert.ok(!/innerHTML/.test(rend), 'caller text is set with textContent, never innerHTML');

// ── 12. npm run check runs this test ─────────────────────────────────────────
const pkg = JSON.parse(read('package.json'));
assert.ok(/node tests\/incoming-call-overlay\.test\.js/.test(pkg.scripts.check), 'npm run check runs this test');
for (const f of ['src/call-overlay.js', 'src/call-overlay-preload.js', 'src/call-overlay-renderer.js']) {
  assert.ok(pkg.scripts.check.includes(`node --check ${f}`), `npm run check syntax-checks ${f}`);
}

Module._load = origLoad;
console.log('PASS — incoming calls pop up over everything with Answer / Decline');
