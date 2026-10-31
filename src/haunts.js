// Haunted houses to pick a start from: a house rises out of the ground haunted (in a puff of mist)
// as you go near it, and sinks back when you move on. Four crooked silhouettes (a towered Victorian drawn either
// way round, a gothic gable, a sagging cottage), with glowing arched windows, boarded-up panes, a
// door that swings open on hover, and smoke for the chosen one. Every house gets its own steady
// "random" look, tilt and size, so a street reads as a row of mismatched old places.

// Shared gradients, defined once in the page and used by every house (styled in style.css).
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="hh-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#352a4f"/><stop offset="1" stop-color="#15101f"/></linearGradient>
  <linearGradient id="hh-roof" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2140"/><stop offset="1" stop-color="#0e0b14"/></linearGradient>
  <radialGradient id="hh-glow" cx=".5" cy=".6" r=".7"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#ffb347"/><stop offset="1" stop-color="#e05a12"/></radialGradient>
  <radialGradient id="hh-ground" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".75"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <radialGradient id="hh-lit" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".8"/><stop offset=".6" stop-color="#ff8a2e" stop-opacity=".25"/><stop offset="1" stop-color="#ff8a2e" stop-opacity="0"/></radialGradient>
</defs></svg>`;
let defsReady = false;
const ensureDefs = () => {
  if (defsReady || typeof document === 'undefined') return;
  document.body.insertAdjacentHTML('afterbegin', DEFS);
  defsReady = true;
};

// Pieces, in viewBox units (40 × 44, ground at y = 41).
const f = (n) => +n.toFixed(2);
const bars = (x, y, w, h, top) => `<path class="bars" d="M${f(x + w / 2)} ${f(top)}V${f(y + h)}M${x} ${f(y + h * 0.6)}H${f(x + w)}"/>`;
// A pointed gothic window glowing from inside, with crossbars.
const lancet = (x, y, w, h, cls = '') => `<path class="win ${cls}" d="M${x} ${f(y + h)}V${f(y + w * 0.7)}Q${x} ${f(y + w * 0.15)} ${f(x + w / 2)} ${y}Q${f(x + w)} ${f(y + w * 0.15)} ${f(x + w)} ${f(y + w * 0.7)}V${f(y + h)}Z"/>${bars(x, y, w, h, y + 0.8)}`;
const sqwin = (x, y, w, h, cls = '') => `<rect class="win ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx=".3"/>
  <path class="bars" d="M${f(x + w / 2)} ${y}V${f(y + h)}M${x} ${f(y + h / 2)}H${f(x + w)}"/>`;
const roundwin = (cx, cy, r, cls = '') => `<circle class="win ${cls}" cx="${cx}" cy="${cy}" r="${r}"/>
  <path class="bars" d="M${cx} ${f(cy - r)}V${f(cy + r)}M${f(cx - r)} ${cy}H${f(cx + r)}"/>`;
// A dark pane nailed shut with two crooked planks.
const boarded = (x, y, w, h) => `<rect class="pane" x="${x}" y="${y}" width="${w}" height="${h}" rx=".3"/>
  <path class="plank" d="M${f(x - 0.6)} ${f(y + h * 0.32)}L${f(x + w + 0.6)} ${f(y + h * 0.12)}M${f(x - 0.5)} ${f(y + h * 0.72)}L${f(x + w + 0.5)} ${f(y + h * 0.94)}"/>`;
// An arched door (hinged on its left) over a lit doorway that shows when it swings open.
const door = (x, w, h) => {
  const d = `M${x} 41V${f(41 - h + w / 2)}a${w / 2} ${w / 2} 0 0 1 ${w} 0V41Z`;
  return `<path class="doorway" d="${d}"/><path class="door" d="${d}"/>`;
};
const shadow = (rx) => `<ellipse class="ground" cx="20" cy="41.2" rx="${rx}" ry="2.6"/>`;
const smoke = (x, y) => `<path class="smoke" pathLength="10" d="M${x} ${y}c-1.7-2 1.7-3.2 0-5.2c-1.3-1.6.9-2.8.2-4.4"/>
  <path class="smoke s2" pathLength="10" d="M${f(x + 0.6)} ${y}c1.5-1.8-1.3-3 .3-4.8c1.1-1.4-.6-2.4.1-3.8"/>`;

// [svg body, chimney top (x, y) for the ghost and smoke]
// A towered Victorian: sagging gable, a leaning tower under a witch-hat roof with a bent tip,
// a porch, one shutter hanging loose and one window boarded up.
const VICTORIAN = [`${shadow(17)}
  <path class="hl roof" d="M7.2 21.4V14.4l1.4-.5 1.9.6v5Z"/><path class="hl-cap" d="M6.5 14.3l2.1-.7 2.5.8"/>
  <path class="hl wall" d="M5.2 41l.7-17.4h18.7V41Z"/><path class="rim" d="M24.6 24.2V40.6"/>
  <path class="hl roof" d="M2.4 24.8Q9.4 19.2 15.4 12.4q5 6.6 12.2 12-12.4-2.2-25.2.4Z"/><path class="rim" d="M15.4 12.4q5 6.6 12.2 12"/>
  <path class="hl wall" d="M24 41l.6-23h9.2l-.4 23Z"/><path class="rim" d="M33.8 18.6 33.4 40.6"/>
  <path class="hl roof" d="M23 18.8q5-3.8 6.8-15.8 1.4 11.6 5.6 15.8-6.2-1.4-12.4 0Z"/>
  <path class="rim" d="M29.8 3q1.4 11.6 5.6 15.8"/><path class="spire" d="M29.8 3q1.8-1 2.6.7"/>
  ${lancet(27.4, 21.6, 3.2, 5.4, 'w3')}${lancet(27.4, 30.6, 3, 4.6, 'w2')}${roundwin(15.4, 18.8, 1.8, 'w2 ghosty')}
  <path class="shutter" d="M6.1 27.6l1.4-.2.9 6-1.4.4Z"/>${lancet(8, 26.6, 3.8, 6)}${boarded(17.6, 27.2, 3.8, 5.2)}
  <path class="hl roof" d="M10 34.4l10.2-.6-.8 1.4-8.8.4Z"/><path class="post" d="M11 35.6V41M19.2 35.2V41"/>
  ${door(13.2, 3.6, 5.4)}`, [8.8, 13.6]];
// A tall gothic gable, leaning a little, with a broken-topped chimney and a tombstone out front.
const GOTHIC = [`${shadow(16)}
  <path class="hl roof" d="M26.6 15V7.7l1.1-.5.7.9 1.3-1.1V18Z"/>
  <path class="hl wall" d="M10.2 41l.9-20.8h19L30 41Z"/><path class="rim" d="M30.1 21 30 40.6"/>
  <path class="hl roof" d="M7.8 21.4Q14 15.4 20.4 7.6q5.8 7.4 12.6 13.8-12.6-2.8-25.2 0Z"/><path class="rim" d="M20.4 7.6q5.8 7.4 12.6 13.8"/>
  ${roundwin(20.4, 15.4, 2.1, 'w3 ghosty')}${lancet(13.4, 22.2, 3.6, 5.8)}${boarded(23.6, 22.8, 3.6, 5.2)}
  ${sqwin(12.6, 31.4, 5.6, 4.4, 'w2')}${door(22.2, 4, 6.6)}
  <path class="stone" d="M2.6 41v-4a2.1 2.1 0 0 1 4.2 0v4Z"/><path class="carve" d="M4.7 37.2v2.2M3.9 38h1.6"/>`, [27.9, 6.6]];
// A squat cottage under a deeply sagging roof, with a leaning chimney and a dead tree.
const COTTAGE = [`${shadow(17)}
  <path class="hl roof" d="M22.8 24l.8-8.6 3 .4-.8 8.2Z"/><path class="hl-cap" d="M23 15.4l4.2.5"/>
  <path class="hl wall" d="M6 41l.3-13h21.7l.4 13Z"/><path class="rim" d="M28 28.4l.4 12.2"/>
  <path class="hl roof" d="M3 29.2Q11 25.8 16.8 17.4q4.4 7.6 14.4 11.2-14.2-3.4-28.2.6Z"/><path class="rim" d="M16.8 17.4q4.4 7.6 14.4 11.2"/>
  ${roundwin(16.8, 23.6, 1.5, 'w3 ghosty')}${sqwin(8.6, 31, 4, 4)}${sqwin(21.6, 31, 4, 4, 'w2')}
  <path class="shutter" d="M25.9 30.6l1.3.4-.4 4.8-1.3-.2Z"/>${door(15, 3.8, 6.2)}
  <path class="tree" d="M35.4 41q-.4-6 .4-10.6M35.6 32.6q2.2-2 2.6-4.8M35.8 30.4q-1.2-2.4-.6-5M35.4 34.4q-2.4-1-3-2.8M37.6 29.6l1.4-.6"/>
  <path class="tree-rim" d="M35.9 40.6q-.3-5 .3-9.6"/>`, [25.1, 15.2]];

// top: the highest point (viewBox y), so the start pin can float just above the roof.
const VARIANTS = [
  { body: VICTORIAN[0], chimney: VICTORIAN[1], top: 2.3 },
  { body: `<g transform="matrix(-1 0 0 1 40 0)">${VICTORIAN[0]}</g>`, chimney: [40 - VICTORIAN[1][0], VICTORIAN[1][1]], top: 2.3 },
  { body: GOTHIC[0], chimney: GOTHIC[1], top: 6.5 },
  { body: COTTAGE[0], chimney: COTTAGE[1], top: 15.2 },
];

// Icon size on screen (px) and where the house meets the ground.
export const HAUNT_W = 34, HAUNT_H = 37;
const SCALE = HAUNT_W / 40;

const pick = (id) => {
  const r = (k) => ((((id * (7919 * k + 13)) % 1000) + 1000) % 1000) / 1000; // steady per house
  return { r, v: VARIANTS[Math.floor(r(3) * VARIANTS.length)], s: 0.9 + r(2) * 0.2 };
};

// How far above the ground the chosen house's peak stands, in px (it's drawn 1.25× when chosen).
export function hauntPeak(id) {
  const { v, s } = pick(id);
  return (41 - v.top) * SCALE * s * 1.25;
}

export function hauntHtml(id) {
  const { r, v, s } = pick(id);
  const [cx, cy] = v.chimney;
  const style = `--tilt:${((r(1) - 0.5) * 8).toFixed(1)}deg;--s:${s.toFixed(2)};`
    + `--gx:${f(cx * SCALE)}px;--gy:${f(cy * SCALE)}px;--gd:${cx < 20 ? -1 : 1}`; // the ghost drifts away from the pin, chimney side
  // Smoke last, so it never hides behind a roof.
  return `<span class="mist"></span><span class="hb" style="${style}"><svg viewBox="0 0 40 44" aria-hidden="true">${v.body}${smoke(cx, cy)}</svg></span>`;
}

// units > 1 (a duplex, a row of houses) adds a little "×2" sign by the door.
export function hauntIcon(id, extra = '', units = 1) {
  ensureDefs();
  return L.divIcon({
    className: `haunt${extra}`, html: hauntHtml(id) + (units > 1 ? `<span class="hu" aria-hidden="true">×${units}</span>` : ''),
    iconSize: [HAUNT_W, HAUNT_H], iconAnchor: [HAUNT_W / 2, f(41 * SCALE)], tooltipAnchor: [0, -44],
  });
}

// Keep the street alive: every so often one house's windows flicker, a pale shape passes a window,
// or a bat takes off from a roof. A few houses at a time, picked at random, rather than a CSS loop
// on every house (which would repaint them all, every frame). markers() → the Leaflet markers on screen.
export function haunting(markers) {
  const timers = [];
  const poke = (cls, ms) => {
    const all = markers();
    const el = all[Math.floor(Math.random() * all.length)]?.getElement();
    if (!el || el.classList.contains('chosen') || el.classList.contains(cls)) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  };
  return {
    start() {
      if (timers.length) return;
      timers.push(setInterval(() => poke('flick', 1300), 450), setInterval(() => poke('ghost-pass', 1800), 2900),
        setInterval(() => poke('bat', 1000), 4700));
    },
    stop() { timers.splice(0).forEach(clearInterval); },
  };
}

// For pages that draw houses without Leaflet (previews).
export { ensureDefs };
