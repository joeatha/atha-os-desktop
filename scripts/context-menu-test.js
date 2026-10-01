// Right-click a misspelled word → suggestions (Atha OS Dev 958d6065 / 71fb519d).
//
//   node scripts/context-menu-test.js
//
// Runs the real buildContextMenuTemplate()/wireContextMenu() from
// src/context-menu.js against stubs, and checks window.js actually wires it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildContextMenuTemplate, wireContextMenu } = require('../src/context-menu');

const calls = [];
const actions = { replace: (w) => calls.push(['replace', w]), addToDictionary: (w) => calls.push(['add', w]) };
const labels = (t) => t.map((i) => i.label || i.role || i.type);

// A misspelled word in a text box: the suggestions first, each one replaces.
let t = buildContextMenuTemplate({
  isEditable: true, misspelledWord: 'recieve', dictionarySuggestions: ['receive', 'relieve'],
  editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
}, actions);
assert.deepStrictEqual(labels(t).slice(0, 3), ['receive', 'relieve', 'Add to Dictionary']);
t[0].click(); t[2].click();
assert.deepStrictEqual(calls, [['replace', 'receive'], ['add', 'recieve']]);
assert.ok(labels(t).includes('cut') && labels(t).includes('paste'), 'a text box also gets Cut/Copy/Paste');

// Misspelled with no suggestions: say so, still offer Add to Dictionary.
t = buildContextMenuTemplate({ isEditable: true, misspelledWord: 'Atha', dictionarySuggestions: [], editFlags: {} }, actions);
assert.deepStrictEqual(labels(t).slice(0, 2), ['No spelling suggestions', 'Add to Dictionary']);
assert.strictEqual(t[0].enabled, false);

// A correctly spelled word in a text box: just the edit items.
t = buildContextMenuTemplate({ isEditable: true, misspelledWord: '', editFlags: { canPaste: true } }, actions);
assert.ok(!labels(t).includes('Add to Dictionary'));
assert.strictEqual(t.find((i) => i.role === 'paste').enabled, true);
assert.strictEqual(t.find((i) => i.role === 'cut').enabled, false);

// Selected text on the page: Copy. Nothing selected, not editable: no menu.
assert.deepStrictEqual(labels(buildContextMenuTemplate({ selectionText: 'hello', editFlags: {} }, actions)), ['copy']);
assert.deepStrictEqual(buildContextMenuTemplate({ selectionText: '  ', editFlags: {} }, actions), []);

// wireContextMenu: the right-click event pops the menu, with replace wired to the page.
let handler = null, popped = null;
const wc = {
  on: (ev, fn) => { if (ev === 'context-menu') handler = fn; },
  replaceMisspelling: (w) => calls.push(['wc-replace', w]),
  session: { addWordToSpellCheckerDictionary: (w) => calls.push(['wc-add', w]) },
};
const Menu = { buildFromTemplate: (tpl) => ({ popup: (o) => { popped = { tpl, o }; } }) };
wireContextMenu(wc, { Menu, getWindow: () => 'WIN' });
assert.ok(handler, 'listens for context-menu');
handler({}, { isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the'], editFlags: {} });
assert.ok(popped && popped.o.window === 'WIN', 'the menu pops over the window');
popped.tpl[0].click();
assert.deepStrictEqual(calls.slice(-1), [['wc-replace', 'the']]);
popped = null; handler({}, { editFlags: {} });
assert.strictEqual(popped, null, 'an empty menu is never shown');

// And the window actually uses it.
const winSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'window.js'), 'utf8');
assert.match(winSrc, /wireContextMenu\(win\.webContents/, 'window.js wires the context menu');
assert.match(winSrc, /spellcheck: true/, 'spellcheck stays on');
console.log('context-menu-test: ok');
