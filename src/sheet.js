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
    if (name !== 'full') panel.scrollTop = 0; // only a full sheet scrolls
    panel.dataset.snap = name;
    place(heights()[name], animate);
  };

  const apply = () => {
    panel.style.setProperty('--sheet-h', `${innerHeight - TOP_GAP}px`);
    if (MOBILE.matches) to(snap, false);
    else { panel.style.transform = ''; panel.classList.remove('dragging'); root.style.removeProperty('--sheet-vis'); root.classList.remove('sheet-high'); vis = 0; }
  };

  // A drag follows the finger; on release it flings or settles to a height.
  const begin = (y) => { drag = { y, from: vis, lastY: y, lastT: performance.now(), v: 0, moved: false }; };
  const follow = (y) => {
    const now = performance.now();
    drag.v = (drag.lastY - y) / Math.max(1, now - drag.lastT); // px/ms, up is positive
    drag.lastY = y; drag.lastT = now;
    if (Math.abs(y - drag.y) > 6) drag.moved = true;
    if (drag.moved) place(drag.from + (drag.y - y), false);
  };

  grab.addEventListener('pointerdown', (e) => {
    if (!MOBILE.matches || e.target.closest('button')) return;
    begin(e.clientY);
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => { if (drag) follow(e.clientY); });
  const release = () => {
    if (!drag) return;
    const { moved, v } = drag;
    drag = null;
    const h = heights();
    if (!moved) { to(snap === 'peek' ? 'half' : 'peek'); return; }
    settle(h, v);
  };
  const settle = (h, v) => {
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

  // The rest of the sheet drags too, like any bottom sheet: below full height a vertical swipe
  // anywhere moves it (its content doesn't scroll then); at full height the content scrolls, and
  // pulling down from the top of it brings the sheet down. Sideways gestures (sliders, the
  // elevation scrubber) are left alone.
  let touch = null;
  panel.addEventListener('touchstart', (e) => {
    if (!MOBILE.matches || e.touches.length > 1 || grab.contains(e.target) || drag) { touch = null; return; }
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, mode: null, free: !!e.target.closest('input[type=range], .plot') };
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (!touch) return;
    const t = e.touches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (!touch.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      const vertical = Math.abs(dy) > Math.abs(dx);
      touch.mode = !vertical || touch.free ? 'none'
        : snap !== 'full' || (panel.scrollTop <= 0 && dy > 0) ? 'sheet' : 'scroll';
      if (touch.mode === 'sheet') { begin(touch.y); drag.moved = true; }
    }
    if (touch.mode !== 'sheet') return;
    if (e.cancelable) e.preventDefault();
    follow(t.clientY);
  }, { passive: false });
  const touchEnd = () => {
    if (touch?.mode === 'sheet' && drag) { const { v } = drag; drag = null; settle(heights(), v); }
    touch = null;
  };
  panel.addEventListener('touchend', touchEnd);
  panel.addEventListener('touchcancel', touchEnd);

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
