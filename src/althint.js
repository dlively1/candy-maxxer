// One route is the default. Once someone scrolls down through it and the ✏️ on their plan is in
// view, a ghost drifts in beside it to whisper that a second route can be summoned to compare.
// At most once per visit, and never again once they've tried a comparison.

const SHOW_MS = 7000, TRIED_KEY = 'cm:altTried';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

export function initAltHint({ panel, summary, hint, alt, open }) {
  let scrolled = false, seen = false, visible = false, timer = 0, wait = 0;
  const tried = () => { try { return !!localStorage.getItem(TRIED_KEY); } catch { return false; } };
  const eligible = () => !seen && !tried() && alt.value === 'none'
    && document.body.classList.contains('has-plan') && !document.body.classList.contains('editing');

  function show() {
    if (!eligible() || !scrolled || !visible) return;
    if (!document.getElementById('share-hint').hidden) { soon(); return; } // one ghost at a time
    seen = true;
    hint.classList.remove('out');
    hint.hidden = false;
    summary.classList.add('haunted');
    timer = setTimeout(hide, SHOW_MS);
  }
  function hide() {
    clearTimeout(timer); clearTimeout(wait);
    summary.classList.remove('haunted');
    if (hint.hidden) return;
    if (reduced.matches) { hint.hidden = true; return; }
    hint.classList.add('out');
    setTimeout(() => { hint.hidden = true; hint.classList.remove('out'); }, 320);
  }
  // Pause a beat once the pencil comes into view, so the ghost doesn't startle mid-flick.
  const soon = () => { clearTimeout(wait); wait = setTimeout(show, 450); };

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting && e.intersectionRatio > 0.95;
    if (visible) soon(); else if (!hint.hidden) hide();
  }, { threshold: [0, 0.96] }).observe(summary);

  // Scrolling down: the panel scrolls, or (when it all fits) a downward wheel over it, opening the
  // directions at the bottom, or on a phone pulling the sheet up past its peek.
  const down = () => { if (!scrolled) { scrolled = true; soon(); } };
  panel.addEventListener('scroll', () => { if (panel.scrollTop > 24) down(); }, { passive: true });
  panel.addEventListener('wheel', (e) => { if (e.deltaY > 0) down(); }, { passive: true });
  document.getElementById('dirBox').addEventListener('toggle', (e) => { if (e.target.open) down(); });
  new MutationObserver(() => { if (panel.dataset.snap && panel.dataset.snap !== 'peek') down(); })
    .observe(panel, { attributes: true, attributeFilter: ['data-snap'] });

  hint.addEventListener('click', (e) => {
    e.stopPropagation();
    markTried();
    hide();
    open();
  });
  document.addEventListener('click', (e) => { if (!hint.contains(e.target)) hide(); }, true);
  alt.addEventListener('change', () => { if (alt.value !== 'none') markTried(); });

  function markTried() { try { localStorage.setItem(TRIED_KEY, '1'); } catch { /* no storage */ } }

  // A new plan is on screen: the next scroll can summon the ghost (if it hasn't appeared yet).
  return { planned: () => { scrolled = panel.scrollTop > 24; hide(); } };
}
