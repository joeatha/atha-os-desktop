// An incoming call must not raise a critical OS toast while the Atha OS window
// is already in front: the toast lands on the in-app call bar's Answer button
// and staff click it instead of answering (Atha OS Dev item 2d203bdf). When the
// window is hidden, minimized or behind another app, the toast still shows.
//
//   node scripts/incoming-call-toast-test.js
//
// Runs the real notifyIncomingCall() from src/window.js against stubs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'window.js'), 'utf8');
const start = src.indexOf('function notifyIncomingCall(');
assert.ok(start >= 0, 'notifyIncomingCall not found in src/window.js');
let depth = 0, i = src.indexOf('{', start);
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}' && --depth === 0) break;
}
const fnSrc = src.slice(start, i + 1);

function run(winState) {
  const shown = [];
  class Notification {
    static isSupported() { return true; }
    constructor(opts) { this.opts = opts; }
    on() {}
    show() { shown.push(this.opts); }
  }
  const win = winState && {
    isDestroyed: () => false,
    isVisible: () => winState.visible,
    isFocused: () => winState.focused,
    isMinimized: () => winState.minimized,
    flashFrame() {}, setAlwaysOnTop() {},
  };
  // eslint-disable-next-line no-new-func
  const notify = new Function('Notification', 'log', 'win', 'showWindow', 'process',
    fnSrc + '\nreturn notifyIncomingCall;')(Notification, { info() {} }, win, () => {}, { platform: 'win32' });
  notify({ from: '+13175551234', name: 'Resident' });
  return shown.length;
}

assert.strictEqual(run({ visible: true, focused: true, minimized: false }), 0, 'window in front: no toast over Answer');
assert.strictEqual(run({ visible: true, focused: false, minimized: false }), 1, 'window behind another app: toast');
assert.strictEqual(run({ visible: true, focused: true, minimized: true }), 1, 'window minimized: toast');
assert.strictEqual(run({ visible: false, focused: false, minimized: false }), 1, 'window hidden in tray: toast');
assert.strictEqual(run(null), 1, 'no window at all: toast');
console.log('PASS — incoming-call toast only when the Atha OS window is not in front');
