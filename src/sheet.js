// Phones: the panel is a bottom sheet over a full-screen map. Drag the grab bar (or tap it) to move
// between three heights: peek (just the haul, or the search bar before a plan), half, and full.
// On desktop the panel instead floats over the map's left edge.
// The visible height is published as --sheet-vis so floating bits (share pill, toasts) ride above it.

const MOBILE = matchMedia('(max-width: 760px)');
const TOP_GAP = 56; // map left showing above a fully open sheet

export function initSheet(panel, grab) {
  let snap = 'half', vis = 0, drag = null;
  const root = document.documentElement;

  const height = () => panel.offsetHeight;
  const peekH = () => {
    // The bottom of whatever must stay visible when collapsed.
    const els = [...panel.querySelectorAll('[data-peek]')].filter((el) => el.offsetParent && el.offsetHeight);
    return Math.min(height(), Math.max(grab.offsetHeight, ...els.map((el) => el.offsetTop + el.offsetHeight)) + 12);
  };
  const heights = () => ({ peek: peekH(), half: Math.max(peekH(), Math.round(innerHeight * 0.5)), full: height() });

  const place = (px, animate) => {
    vis = Math.max(0, Math.min(height(), px));
    panel.classList.toggle('dragging', !animate);
    panel.style.transform = `translateY(${height() - vis}px)`;
    root.style.setProperty('--sheet-vis', `${vis}px`);
    root.classList.toggle('sheet-high', vis > innerHeight * 0.6); // too little map left for floating buttons
  };

  const to = (name, animate = true) => {
    if (!MOBILE.matches) return;
    snap = name;
    if (name === 'peek') panel.scrollTop = 0;
    panel.dataset.snap = name;
    place(heights()[name], animate);
  };

  const apply = () => {
    panel.style.setProperty('--sheet-h', `${innerHeight - TOP_GAP}px`);
    if (MOBILE.matches) to(snap, false);
    else { panel.style.transform = ''; panel.classList.remove('dragging'); root.style.removeProperty('--sheet-vis'); root.classList.remove('sheet-high'); vis = 0; }
  };

  grab.addEventListener('pointerdown', (e) => {
    if (!MOBILE.matches || e.target.closest('button')) return;
    drag = { y: e.clientY, from: vis, t: performance.now(), lastY: e.clientY, lastT: performance.now(), v: 0, moved: false };
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = performance.now();
    drag.v = (drag.lastY - e.clientY) / Math.max(1, now - drag.lastT); // px/ms, up is positive
    drag.lastY = e.clientY; drag.lastT = now;
    if (Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved) place(drag.from + (drag.y - e.clientY), false);
  });
  const release = () => {
    if (!drag) return;
    const { moved, v } = drag;
    drag = null;
    const h = heights();
    if (!moved) { to(snap === 'peek' ? 'half' : 'peek'); return; }
    // Fling to the next height in the direction of travel; otherwise settle on the nearest.
    const order = ['peek', 'half', 'full'];
    if (Math.abs(v) > 0.5) {
      const above = order.filter((n) => h[n] > vis + 1), below = order.filter((n) => h[n] < vis - 1);
      to(v > 0 ? (above[0] || 'full') : (below.at(-1) || 'peek'));
    } else {
      to(order.reduce((best, n) => (Math.abs(h[n] - vis) < Math.abs(h[best] - vis) ? n : best)));
    }
  };
  grab.addEventListener('pointerup', release);
  grab.addEventListener('pointercancel', release);

  addEventListener('resize', apply);
  MOBILE.addEventListener('change', apply);
  apply();

  return {
    to,
    refresh: () => MOBILE.matches && !drag && to(snap), // re-measure after content changes
    visible: () => (MOBILE.matches ? vis : 0),
    coverLeft: () => (MOBILE.matches ? 0 : panel.offsetLeft + panel.offsetWidth), // desktop: panel floats over the map

    get snap() { return snap; },
    get mobile() { return MOBILE.matches; },
  };
}
