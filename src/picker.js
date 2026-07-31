'use strict';

// Renderer for the screen-share source picker. Talks to the main process only
// through the `athaPicker` bridge (src/picker-preload.js).

(function () {
  const grid = document.getElementById('grid');
  const shareBtn = document.getElementById('share');
  const cancelBtn = document.getElementById('cancel');
  const tabs = {
    screen: document.getElementById('tab-screen'),
    window: document.getElementById('tab-window'),
  };

  let sources = [];
  let kind = 'screen';
  let selected = null;

  function select(id) {
    selected = id;
    shareBtn.disabled = !id;
    grid.querySelectorAll('.card').forEach((c) => {
      c.setAttribute('aria-pressed', String(c.dataset.id === id));
    });
  }

  function render() {
    for (const [k, tab] of Object.entries(tabs)) {
      tab.setAttribute('aria-selected', String(k === kind));
    }
    grid.textContent = '';
    const list = sources.filter((s) => s.kind === kind);

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = kind === 'screen' ? 'No screens found.' : 'No open windows found.';
      grid.appendChild(empty);
      return;
    }

    for (const s of list) {
      const card = document.createElement('button');
      card.className = 'card';
      card.dataset.id = s.id;
      card.setAttribute('aria-pressed', String(s.id === selected));

      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.alt = '';
      if (s.thumbnail) thumb.src = s.thumbnail;
      card.appendChild(thumb);

      const label = document.createElement('div');
      label.className = 'label';
      if (s.appIcon) {
        const icon = document.createElement('img');
        icon.src = s.appIcon;
        icon.alt = '';
        label.appendChild(icon);
      }
      const name = document.createElement('span');
      name.textContent = s.name;
      name.title = s.name;
      label.appendChild(name);
      card.appendChild(label);

      card.addEventListener('click', () => select(s.id));
      card.addEventListener('dblclick', () => window.athaPicker.choose(s.id));
      grid.appendChild(card);
    }
  }

  for (const [k, tab] of Object.entries(tabs)) {
    tab.addEventListener('click', () => {
      kind = k;
      select(null);
      render();
    });
  }

  shareBtn.addEventListener('click', () => {
    if (selected) window.athaPicker.choose(selected);
  });
  cancelBtn.addEventListener('click', () => window.athaPicker.cancel());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.athaPicker.cancel();
    if (e.key === 'Enter' && selected) window.athaPicker.choose(selected);
  });

  window.athaPicker
    .getSources()
    .then((list) => {
      sources = Array.isArray(list) ? list : [];
      // Default to whichever tab actually has something in it.
      if (!sources.some((s) => s.kind === 'screen')) kind = 'window';
      render();
    })
    .catch(() => {
      sources = [];
      render();
    });
})();
