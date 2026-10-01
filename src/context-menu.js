'use strict';

// Right-click menu for the Atha OS window: spelling suggestions, Add to
// Dictionary, and Cut / Copy / Paste / Select All.
//
// Atha OS Development 958d6065 (JC, 2026-07-28) and 71fb519d (Justin Norris,
// 2026-09-30): misspelled words were underlined in red but right-clicking did
// nothing. `spellcheck: true` (window.js) turns on Chromium's checker, which
// draws the underline — but Electron shows NO context menu unless the app builds
// one, and this shell never did, in any version. So there were no suggestions,
// and no Cut/Copy/Paste either. In Chrome the browser draws its own menu, which
// is why the same page worked there.
//
// The template is built by a plain function (no Electron) so
// scripts/context-menu-test.js can run it in node.

/**
 * params: Electron's context-menu params (misspelledWord, dictionarySuggestions,
 *         isEditable, editFlags, selectionText).
 * actions: { replace(word), addToDictionary(word) }.
 * → a Menu template array, or [] when there is nothing worth showing.
 */
function buildContextMenuTemplate(params, actions) {
  const p = params || {};
  const flags = p.editFlags || {};
  const out = [];

  if (p.isEditable && p.misspelledWord) {
    const suggestions = (p.dictionarySuggestions || []).slice(0, 6);
    if (suggestions.length) {
      for (const s of suggestions) out.push({ label: s, click: () => actions.replace(s) });
    } else {
      out.push({ label: 'No spelling suggestions', enabled: false });
    }
    out.push({ label: 'Add to Dictionary', click: () => actions.addToDictionary(p.misspelledWord) });
    out.push({ type: 'separator' });
  }

  if (p.isEditable) {
    out.push({ role: 'cut', enabled: !!flags.canCut });
    out.push({ role: 'copy', enabled: !!flags.canCopy });
    out.push({ role: 'paste', enabled: !!flags.canPaste });
    out.push({ type: 'separator' });
    out.push({ role: 'selectAll', enabled: flags.canSelectAll !== false });
  } else if (p.selectionText && String(p.selectionText).trim()) {
    out.push({ role: 'copy', enabled: flags.canCopy !== false });
  }
  return out;
}

// Wire it to a window's webContents.
function wireContextMenu(webContents, { Menu, getWindow }) {
  webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, {
      replace: (word) => webContents.replaceMisspelling(word),
      addToDictionary: (word) => webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: getWindow() });
  });
}

module.exports = { buildContextMenuTemplate, wireContextMenu };
