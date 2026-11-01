'use strict';

// Renderer for the incoming-call pop-up. Talks to the main process only
// through the `athaCallOverlay` bridge (src/call-overlay-preload.js). Caller
// text is set with textContent, never parsed as HTML.

(function () {
  const nameEl = document.getElementById('name');
  const numberEl = document.getElementById('number');
  const labelEl = document.getElementById('label');
  const answerBtn = document.getElementById('answer');
  const declineBtn = document.getElementById('decline');
  const bridge = window.athaCallOverlay;

  // "+13175551234" → "(317) 555-1234"; anything else is shown as given.
  function formatNumber(v) {
    const s = String(v || '').trim();
    const d = s.replace(/\D/g, '');
    const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
    if (ten.length === 10 && /^[+\d\s().-]+$/.test(s)) {
      return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
    }
    return s;
  }

  function setBusy(busy) {
    answerBtn.disabled = busy;
    declineBtn.disabled = busy;
  }

  function render(info) {
    info = info || {};
    const number = formatNumber(info.from);
    const rawName = String(info.name || '').trim();
    const emergency = /EMERGENCY/i.test(rawName);
    const name = rawName.replace(/^\W*EMERGENCY\s*[–-]\s*/i, '').trim();
    const sameAsNumber = !name || name === info.from || formatNumber(name) === number;

    document.body.classList.toggle('emergency', emergency);
    labelEl.textContent = emergency ? 'Emergency call' : 'Incoming call';
    nameEl.textContent = sameAsNumber ? number || 'Unknown caller' : name;
    nameEl.title = nameEl.textContent;
    numberEl.textContent = sameAsNumber ? '' : number;
    setBusy(false);
  }

  answerBtn.addEventListener('click', () => {
    setBusy(true);
    if (bridge) bridge.answer();
  });
  declineBtn.addEventListener('click', () => {
    setBusy(true);
    if (bridge) bridge.decline();
  });

  if (bridge) bridge.onInfo(render);
})();
