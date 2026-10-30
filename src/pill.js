// The floating "Share route" pill: collapses to a pumpkin while the map is in use,
// bounces in whenever a route is ready, and (once ever) a ghost whispers what it is for.

const IDLE_MS = 1200, HINT_MS = 4000, HINT_KEY = 'cm:shareHint';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

export function initPill(map, pill) {
  const hint = document.getElementById('share-hint');
  let idle, hintTimer;

  const collapse = () => {
    clearTimeout(idle);
    if (!pill.classList.contains('done')) pill.classList.add('collapsed');
  };
  const expandSoon = () => {
    clearTimeout(idle);
    idle = setTimeout(() => pill.classList.remove('collapsed'), IDLE_MS);
  };
  map.on('movestart zoomstart', collapse);
  map.on('moveend zoomend', expandSoon);
  // Touch drags fire movestart too, but be eager so the pill gets out of the way on first contact.
  map.getContainer().addEventListener('touchstart', collapse, { passive: true });
  map.getContainer().addEventListener('touchend', expandSoon, { passive: true });

  function hideHint() {
    clearTimeout(hintTimer);
    if (hint.hidden) return;
    if (reduced.matches) { hint.hidden = true; return; }
    hint.classList.add('out');
    setTimeout(() => { hint.hidden = true; hint.classList.remove('out'); }, 300);
  }
  function showHint() {
    try { if (localStorage.getItem(HINT_KEY)) return; localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode: show it anyway */ }
    hint.classList.remove('out');
    hint.hidden = false;
    hintTimer = setTimeout(hideHint, HINT_MS);
  }
  document.addEventListener('click', hideHint, true);

  // Call after a route is drawn: reveal the pill, bounce it, and maybe show the hint.
  function nudge() {
    pill.hidden = false;
    pill.classList.remove('collapsed', 'nudge');
    if (!reduced.matches) { void pill.offsetWidth; pill.classList.add('nudge'); }
    showHint();
  }
  pill.addEventListener('animationend', (e) => { if (e.animationName === 'pill-nudge') pill.classList.remove('nudge'); });
  return { nudge };
}
