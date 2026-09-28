// Clicking the incoming-call toast ("Click to answer in Atha OS") must ask the
// page to ANSWER, not only raise the window (Atha OS Dev item 5ce38cc7: "It
// ended the call when I hit Answer"). The page side (index.html
// osDesktopAnswerRequested) answers only if an inbound call is still ringing.
//
//   node scripts/answer-from-toast-test.js
//
// Runs the real notifyIncomingCall()/answerFromToast() from src/window.js and
// the real preload bridge against stubs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function extract(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

// ── main process: toast click → showWindow + 'athaos:answer-call' ────────────
const winSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'window.js'), 'utf8');
const sent = [];
let shown = 0, clickHandler = null;
class Notification {
  static isSupported() { return true; }
  constructor(opts) { this.opts = opts; }
  on(ev, fn) { if (ev === 'click') clickHandler = fn; }
  show() {}
}
const win = {
  isDestroyed: () => false, isVisible: () => false, isFocused: () => false, isMinimized: () => false,
  flashFrame() {}, setAlwaysOnTop() {},
  webContents: { send: (ch, ...a) => sent.push([ch, ...a]) },
};
// eslint-disable-next-line no-new-func
const api = new Function('Notification', 'log', 'win', 'showWindow', 'process',
  extract(winSrc, 'notifyIncomingCall') + '\n' + extract(winSrc, 'answerFromToast') +
  '\nreturn { notifyIncomingCall, answerFromToast };')(Notification, { info() {} }, win, () => { shown++; }, { platform: 'win32' });

api.notifyIncomingCall({ from: '+13175551234' });
assert.ok(clickHandler, 'toast registers a click handler');
shown = 0; sent.length = 0;
clickHandler();
assert.strictEqual(shown, 1, 'toast click raises the window');
assert.deepStrictEqual(sent, [['athaos:answer-call']], 'toast click asks the page to answer (and passes nothing else)');
assert.ok(/answerFromToast,/.test(winSrc.slice(winSrc.indexOf('module.exports'))), 'answerFromToast is exported');

// ── preload: onAnswerRequested(cb) wires 'athaos:answer-call' with no args ───
const preSrc = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
let exposed = null;
const listeners = {};
const electron = {
  contextBridge: { exposeInMainWorld: (k, v) => { if (k === 'athaDesktop') exposed = v; } },
  ipcRenderer: {
    sendSync: () => '1.0.5', send() {},
    on: (ch, fn) => { (listeners[ch] = listeners[ch] || []).push(fn); },
  },
};
const fakeWindow = { addEventListener() {} };
// eslint-disable-next-line no-new-func
new Function('require', 'window', preSrc)(m => { assert.strictEqual(m, 'electron'); return electron; }, fakeWindow);
assert.strictEqual(typeof exposed.onAnswerRequested, 'function', 'bridge exposes onAnswerRequested');
exposed.onAnswerRequested('not a function');
assert.ok(!listeners['athaos:answer-call'], 'a non-function callback registers nothing');
const calls = [];
exposed.onAnswerRequested((...args) => calls.push(args));
assert.strictEqual(listeners['athaos:answer-call'].length, 1, 'one listener on athaos:answer-call');
listeners['athaos:answer-call'][0]({ sender: 'IPC-EVENT-OBJECT' }, 'extra');
assert.deepStrictEqual(calls, [[]], 'page callback fires with NO args — the IPC event never reaches the page');
exposed.onAnswerRequested(() => { throw new Error('page bug'); });
assert.doesNotThrow(() => listeners['athaos:answer-call'][1]({}), 'a throwing page callback is contained');

console.log('PASS — clicking the incoming-call toast asks the page to answer');
