// Wires the pipeline to the page: a start (picked on the map, found, or geocoded) → OSM →
// elevation → graph → solver worker → map.

import { geocode } from './geocode.js';
import { loadOsm, parseOsm, RADII } from './osm.js';
import { elevations } from './elevation.js';
import { makeProjection } from './geo.js';
import { buildNetwork, buildCSR, attachHouses, levelStructures } from './graph.js';
import { candyValue, OVERRIDES } from './candy.js';
import { PACES } from './tobler.js';
import { renderProfile } from './profile.js';
import { arrowLayer, flowLayer } from './arrows.js';
import { buildSteps, stepText, turnaroundPoints } from './directions.js';
import { createLoader } from './loader.js';
import { shareLink } from './share.js';
import { initPill } from './pill.js';
import { addressBox, locate, reverse, placeLabel } from './address.js';
import { initSheet } from './sheet.js';
import { hauntIcon, hauntPeak, haunting } from './haunts.js';

const $ = (id) => document.getElementById(id);
const M_PER_MI = 1609.344, FT_PER_M = 3.28084;
const ROUTE_COLORS = ['#de7218', '#358de8']; // validated pair: distinct under color-vision deficiency
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const canHover = matchMedia('(hover: hover)');
const HOME_BADGE = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="#14111c" stroke="#f5c542" stroke-width="2"/>
  <path d="M8.5 16.5 16 9.5l7.5 7V24h-15Z" fill="#f5c542"/><rect x="14" y="18.5" width="4" height="5.5" rx="1" fill="#14111c"/></svg>`;
const HOME_SVG = `${HOME_BADGE}<span class="finish-flag" aria-hidden="true">🏁</span>`;
// The start pin while choosing: the home badge on a little stem, floating over its haunted house.
const PIN_HTML = `<span class="pin-b"><span class="pin-bob">${HOME_BADGE}</span></span><i class="pin-stem"></i>`;
// Turnarounds: a little U-turn badge in the route's color, so a mid-street end of the line reads as "come back".
const uturnSvg = (color) => `<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11.5" fill="#14111c" stroke="${color}" stroke-width="2"/>
  <path d="M9 19v-7.5a4 4 0 0 1 8 0V17" fill="none" stroke="#fff3d6" stroke-width="2.2" stroke-linecap="round"/>
  <path d="m13.8 14.6 3.2 3.4 3.2-3.4" fill="none" stroke="#fff3d6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([40.4406, -79.9959], 12); // Pittsburgh until a plan
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  className: 'night-tiles',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const layers = {
  houses: L.layerGroup().addTo(map),
  route: L.layerGroup().addTo(map),
  arrows: L.layerGroup().addTo(map),
  highlight: L.layerGroup().addTo(map),
  cursor: L.layerGroup().addTo(map),
  haunts: L.layerGroup().addTo(map), // haunted houses to pick a start from
  pick: L.layerGroup().addTo(map),   // the start pin while choosing
};

const worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
const loader = createLoader($('loader'));
const pending = new Map();
let progressBase = 0; // share of the loader bar already used by downloads before planning
worker.onmessage = ({ data }) => {
  if (data.progress) {
    if (data.seq === solveSeq) loader.progress(progressBase + data.progress.frac * (1 - progressBase), data.progress.candy);
    return;
  }
  pending.get(data.seq)?.(data);
  pending.delete(data.seq);
};
const overrides = JSON.parse(localStorage.getItem('cm:overrides') || '{}');

let area = null;     // loaded neighborhood: { center, proj, net, houses, z, houseZ, radius, place, startNode }
let solveSeq = 0;
let shown = null;    // last plan: { g, routes, budgetMin }
let focus = 0;       // which route the directions / arrows follow
let fitNext = false; // zoom to the routes on the first plan for a new address
let stopOrder = [];  // per route on screen: Map house index → stop number
let housePolys = []; // one polygon per house in `area`, restyled (not rebuilt) as plans change
let housesFor = null;
let routeLines = []; // drawn route polylines, dimmed while a re-plan is running

for (const [inp, out, fmt] of [['budget', 'budgetOut', (v) => `${v} min`], ['porch', 'porchOut', (v) => `${v} s`]]) {
  const el = $(inp);
  const show = () => {
    $(out).value = fmt(el.value);
    el.style.setProperty('--fill', (el.value - el.min) / (el.max - el.min)); // candy-corn fill
  };
  el.addEventListener('input', show);
  show();
}

// Button groups drive the hidden selects, which stay the source of truth (share links read and write them).
for (const seg of document.querySelectorAll('.seg')) {
  const sel = $(seg.dataset.for);
  seg.innerHTML = [...sel.options].map((o) => `<button type="button" role="radio" data-v="${o.value}">
    <span class="seg-icon" aria-hidden="true">${o.dataset.icon}</span><span class="seg-text"><b>${o.text}</b>${
    o.dataset.sub ? `<small>${o.dataset.sub}</small>` : ''}</span></button>`).join('');
  const btns = [...seg.children];
  const sync = () => btns.forEach((b) => {
    const on = b.dataset.v === sel.value;
    b.setAttribute('aria-checked', on);
    b.tabIndex = on ? 0 : -1;
  });
  const pick = (b) => {
    if (b.dataset.v === sel.value) return;
    sel.value = b.dataset.v;
    sync();
    sel.dispatchEvent(new Event('change'));
  };
  seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b); });
  seg.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const b = btns[(btns.findIndex((x) => x.dataset.v === sel.value) + step + btns.length) % btns.length];
    pick(b);
    b.focus();
  });
  sel.addEventListener('input', sync); // readUrl
  sync();
}

for (const id of ['budget', 'pace', 'porch', 'alt']) $(id).addEventListener('change', () => { planSummary(); if (phase === 'plan') run(); });

// Once there's a plan, the form folds into a one-line summary; tap it to edit.
const formBody = $('formBody');
function editing(on) {
  document.body.classList.toggle('editing', on);
  $('planSum').setAttribute('aria-expanded', on);
  const open = on || !document.body.classList.contains('has-plan');
  formBody.inert = !open;
  if (!open) formBody.classList.remove('settled');
  else if (reduced.matches) formBody.classList.add('settled');
}
// Let the autocomplete list spill out only once the drawer has finished opening.
formBody.addEventListener('transitionend', (e) => {
  if (e.target === formBody && !formBody.inert) formBody.classList.add('settled');
});
formBody.classList.add('settled');
$('planSum').addEventListener('click', () => editing(!document.body.classList.contains('editing')));
$('restart').addEventListener('click', () => {
  const btn = $('restart');
  btn.classList.add('burying'); // the gravestone sinks, then the plan is gone
  setTimeout(() => { btn.classList.remove('burying'); startOver(); }, reduced.matches ? 0 : 420);
});

function planSummary() {
  const short = $('address').value.split(',')[0].trim() || 'Somewhere';
  $('planSum').innerHTML = `<span class="ps-where">📍 ${esc(short)}</span>
    <span class="ps-what">${$('budget').value} min · ${$('pace').selectedOptions[0].text} · ${$('porch').value} s/door</span>
    <span class="ps-edit" aria-hidden="true">✏️</span>`;
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
$('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
$('share').addEventListener('click', share);
const pill = initPill(map, $('share'));
const sheet = initSheet($('panel'), $('grab'));
// The panel floats over the map's left edge on desktop and its bottom on phones: keep controls clear of it.
const placeControls = () => {
  map.zoomControl.setPosition(sheet.mobile ? 'topleft' : 'topright');
  map.attributionControl.setPosition(sheet.mobile ? 'topright' : 'bottomright');
};
matchMedia('(max-width: 760px)').addEventListener('change', placeControls);
placeControls();
// Padding that keeps fitted bounds out from under the panel.
const fitPad = (px) => ({ paddingTopLeft: [px + sheet.coverLeft(), px], paddingBottomRight: [px, px + sheet.visible()] });
$('address').addEventListener('focus', () => sheet.to('full'));

// Where the route starts and ends: { lat, lon, label, house? } (house: the OSM id of a picked house).
// Once picked or found it stays put (and is remembered), so GPS jitter never moves it.
let start = null;
let here = null;    // the last "my location" fix, for nearby suggestions
let phase = 'idle'; // 'idle' | 'pick' (choosing a start on the map) | 'plan' (a route is on screen)
const START_KEY = 'cm:start';

function setStart(s) {
  start = s;
  $('address').value = s.label;
  planSummary();
  try { localStorage.setItem(START_KEY, JSON.stringify(s)); } catch { /* no storage */ }
  if (phase === 'pick') showPin();
}

addressBox({
  input: $('address'),
  list: $('addr-list'),
  // Suggest places near what's on screen (or where they are), not across the country.
  getBias: () => {
    const c = map.getCenter();
    if (map.getZoom() >= 13) return { lat: c.lat, lon: c.lng, strict: true };
    const p = start || here;
    return p ? { lat: p.lat, lon: p.lon, strict: true } : { lat: c.lat, lon: c.lng, strict: false };
  },
  local: localMatches,
  onPick: pickSuggestion,
});
$('locate').addEventListener('click', () => useMyLocation(false));
$('address').addEventListener('change', prefetch); // typed a new address and moved on
$('planHere').addEventListener('click', run);

async function useMyLocation(quiet) {
  const btn = $('locate');
  btn.classList.add('busy');
  try {
    here = await locate();
    await chooseStart(here, { gps: true });
  } catch (e) {
    // Denied, unavailable, or timed out: the default address is still there to use.
    if (quiet) prefetch();
    else status(e.code === 1 ? 'Location is blocked: allow it in your browser settings, or type an address.' : 'Couldn’t find you. Type an address instead.', true);
  } finally {
    btn.classList.remove('busy');
  }
}

// Suggestions from houses already on the map: "12 elm st" finds 12 Elm Street instantly.
const ABBR = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', circle: 'cir', place: 'pl', boulevard: 'blvd', terrace: 'ter' };
const norm = (t) => ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  .replace(/ (street|avenue|road|drive|lane|court|circle|place|boulevard|terrace)(?= )/g, (_, w) => ` ${ABBR[w]}`).trim();
function localMatches(q) {
  const want = norm(q.split(',')[0]);
  if (!area || want.length < 3) return [];
  const out = [];
  for (const h of area.houses) {
    if (!h.address || !norm(h.address).startsWith(want)) continue;
    out.push({ label: houseLabel(h), main: h.address, sub: area.place || 'On the map', icon: '🏚️', lat: h.lat, lon: h.lon, house: h.id });
    if (out.length === 4) break;
  }
  return out;
}

async function pickSuggestion(it) {
  try {
    // A street with their house number but no exact spot: the geocoder finds it.
    const pt = it.lat != null ? it : await geocode(it.label);
    await chooseStart({ lat: pt.lat, lon: pt.lon, label: it.label, house: it.house });
  } catch (e) {
    status(e.message, true);
  }
}

// --- Choosing a start on the map ---

const metersApart = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));
const inArea = (a, pt) => !!a && metersApart(a.center, pt) <= a.radius;

// Fly so pt lands in the middle of the map that isn't under the panel.
function flyToVisible(pt, zoom) {
  const shift = L.point(sheet.coverLeft() / 2, -sheet.visible() / 2);
  const c = map.unproject(map.project([pt.lat, pt.lon], zoom).subtract(shift), zoom);
  if (reduced.matches) map.setView(c, zoom, { animate: false });
  else map.flyTo(c, zoom, { duration: 1.1 });
}

function enterPick() {
  if (phase === 'plan') clearPlan();
  phase = 'pick';
  document.body.classList.add('picking');
}

function leavePick() {
  phase = 'plan';
  document.body.classList.remove('picking');
  layers.pick.clearLayers();
  renderHaunts();
  $('pickbar').hidden = true;
}

// Lay the plan to rest: no route, no start, an empty address box ready for the next one. The
// neighborhood stays loaded, so a nearby address (or a tap on a house) plans quickly.
let resets = 0;
function startOver() {
  resets++; pickSeq++; solveSeq++; // whatever was loading or planning no longer counts
  replanning(false);
  loader.hide({ quick: true });
  if (phase === 'plan') clearPlan();
  phase = 'idle';
  document.body.classList.remove('picking');
  layers.pick.clearLayers();
  $('pickbar').hidden = true;
  start = null;
  try { localStorage.removeItem(START_KEY); } catch { /* no storage */ }
  $('address').value = '';
  $('status').textContent = '';
  $('status').classList.remove('error');
  $('status').removeAttribute('data-peek');
  $('go').disabled = $('planHere').disabled = false;
  history.replaceState(null, '', location.pathname);
  area?.houses.forEach(styleHouse);
  renderHaunts();
  $('address').focus();
}

function clearPlan() {
  shown = null;
  stopOrder = [];
  routeLines = [];
  for (const k of ['route', 'arrows', 'highlight', 'cursor']) layers[k].clearLayers();
  document.body.classList.remove('has-plan');
  editing(false);
  $('results').hidden = true;
  $('share').hidden = true;
  $('addrField').setAttribute('data-peek', '');
  sheet.refresh();
}

// Show the neighborhood around pt and start there: on its house if one is that close, otherwise
// on the street. Then tap another haunted house, or drag the pin, to change it.
let pickSeq = 0;
async function chooseStart(pt, { gps = false } = {}) {
  const seq = ++pickSeq;
  enterPick();
  sheet.to('peek'); // on a phone, make room for the neighborhood
  flyToVisible(pt, Math.max(17, map.getZoom()));
  const keep = !gps && pt.label; // their words (a typed or saved address) beat a made-up label
  setStart({ lat: pt.lat, lon: pt.lon, label: pt.label || 'Dropped pin', ...(pt.house != null ? { house: pt.house } : {}) });
  pickbar('loading');
  const placeP = area && inArea(area, pt) && area.place !== undefined ? null : reverse(pt.lat, pt.lon);
  let a;
  try {
    a = await areaFor(pt, +$('budget').value, { quick: true });
  } catch (e) {
    if (seq === pickSeq) pickbar('error', e.message);
    return;
  }
  if (placeP) { const p = await placeP; a.place ??= p ? placeLabel(p) : ''; }
  if (seq !== pickSeq) return;
  $('status').textContent = '';
  useArea(a);
  const byId = pt.house != null ? a.houses.findIndex((h) => h.id === pt.house) : -1;
  const i = byId >= 0 ? byId : houseNear(pt, gps ? 40 : 30);
  if (i >= 0) pickHouse(i, { label: keep || null, fanfare: !keep });
  else pickStreet(pt, { label: keep || null });
}

// A tap on the map or a dropped pin: the house there, else the street, else look around there.
function pickSpot(ll, { replan = false } = {}) {
  const pt = { lat: ll.lat, lon: ll.lng };
  if (!inArea(area, pt)) { chooseStart(pt); return; }
  const i = houseNear(pt, 30);
  if (i >= 0) pickHouse(i); else pickStreet(pt);
  if (replan) run();
}

function pickHouse(i, { label = null, fanfare = true } = {}) {
  const h = area.houses[i];
  setStart({ lat: h.lat, lon: h.lon, label: label || houseLabel(h), house: h.id });
  if (phase !== 'plan') area.houses.forEach(styleHouse);
  const m = haunts.get(i)?.getElement();
  if (fanfare && m) { m.classList.remove('just'); void m.offsetWidth; m.classList.add('just'); }
}

function pickStreet(pt, { label = null } = {}) {
  const [x, y] = area.proj.toXY(pt.lat, pt.lon);
  const s = area.net.grid.nearest(x, y, 150);
  const at = s ? { lat: area.net.lat[s.id], lon: area.net.lon[s.id] } : pt;
  setStart({ ...at, label: label || withPlace(nameNear(...area.proj.toXY(at.lat, at.lon)) || 'Dropped pin') });
  if (phase !== 'plan') area.houses.forEach(styleHouse);
}

function houseNear(pt, maxM) {
  const [x, y] = area.proj.toXY(pt.lat, pt.lon);
  let best = -1, bd = maxM;
  area.houses.forEach((h, i) => { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = i; } });
  return best;
}

// The nearest real street name (not "driveway" or "footpath") within 150 m.
const GENERIC = new Set(['unnamed road', 'driveway', 'footpath', 'steps']);
function nameNear(x, y) {
  const { net } = area;
  let best = null, bd = Infinity;
  net.grid.within(x, y, 150, (id, d) => {
    if (d >= bd) return;
    const name = [...net.nodeNames[id]].map((k) => net.names[k]).find((n) => !GENERIC.has(n));
    if (name) { best = name; bd = d; }
  });
  return best;
}
const withPlace = (t) => (area.place ? `${t}, ${area.place}` : t);
function houseLabel(h) {
  if (h.address) return withPlace(h.address);
  const street = nameNear(h.x, h.y);
  return withPlace(street ? `House on ${street}` : 'Haunted house');
}

// The bar over the map while choosing: where you'll start, and the button to plan from there.
let barState = 'loading', barMsg = '';
function pickbar(state = barState, msg = barMsg) {
  barState = state; barMsg = msg;
  const bar = $('pickbar');
  bar.hidden = phase !== 'pick';
  bar.classList.toggle('error', state === 'error');
  $('planHere').hidden = state !== 'start';
  if (state === 'loading') { $('pickMsg').innerHTML = '<b>Summoning the neighborhood…</b><small>🦇 Fetching houses & streets</small>'; return; }
  if (state === 'error') { $('pickMsg').innerHTML = `<b>${esc(msg)}</b><small>Try another spot, or type an address.</small>`; return; }
  const tip = !area?.houses.length ? 'No houses are mapped right here 🕸️ Drag the pin to change it.'
    : hauntsHidden ? 'Zoom in to find your house 🔍'
    : canHover.matches ? 'Hover the houses to see who’s home 👻 Tap yours, or drag the pin.'
    : 'Tap your house, or drag the pin, to change it.';
  $('pickMsg').innerHTML = `<b>Start at ${esc(start.label.split(',')[0])}</b><small>${tip}</small>`;
}

// The draggable start pin, over its haunted house (or a lone one on the street).
function showPin() {
  layers.pick.clearLayers();
  if (!start) return;
  const ready = inArea(area, start); // before its neighborhood loads, just the pin
  const onHouse = ready && area.houses.some((h) => h.id === start.house);
  const loneId = Math.round(start.lat * 1e5 + start.lon * 1e5);
  if (ready && !onHouse) {
    L.marker([start.lat, start.lon], { icon: hauntIcon(loneId, ' chosen lone'), interactive: false, keyboard: false })
      .addTo(layers.pick);
  }
  // The stem's tip floats just above the chosen house's roof.
  const peak = ready ? hauntPeak(onHouse ? start.house : loneId) + 4 : 8;
  const pin = L.marker([start.lat, start.lon], {
    icon: L.divIcon({ className: 'start-pin', html: PIN_HTML, iconSize: [32, 46], iconAnchor: [16, Math.round(46 + peak)] }),
    draggable: true, zIndexOffset: 2000, keyboard: false,
  }).addTo(layers.pick);
  dragPreview(pin);
  pin.on('dragend', (e) => pickSpot(e.target.getLatLng()));
  renderHaunts();
  if (ready) pickbar('start');
}

// While a start marker is dragged, light up the house it would land on.
let previewing = -1;
function preview(i) {
  if (i === previewing) return;
  const old = previewing;
  previewing = i;
  if (old >= 0) styleHouse(area.houses[old], old);
  if (i >= 0) housePolys[i]?.setStyle({ color: '#ffb347', fillColor: '#ffb347', fillOpacity: 0.55 });
  if (phase === 'pick') renderHaunts(); // the house under the pin rises
  else haunts.get(old)?.getElement()?.classList.remove('near');
}
function dragPreview(marker) {
  let raf = 0;
  marker.on('drag', (e) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => area && preview(houseNear({ lat: e.latlng.lat, lon: e.latlng.lng }, 30)));
  });
  marker.on('dragend', () => { cancelAnimationFrame(raf); preview(-1); });
}

// Haunted houses while choosing: houses stay plain until you go near one, then it rises out of the
// ground haunted (and sinks back when you move on). The chosen one stays, the one under a dragged
// pin rises, and now and then a house on screen rises for a moment on its own, so the street feels
// alive (phones, with no hover, see that too).
const HAUNT_ZOOM = 15.5;
const haunts = new Map(); // house index → marker (some sinking away)
const revealed = { hover: -1, apparitions: new Set() };
let hauntsFor = null, hauntsHidden = false;
const haunter = haunting(() => [...haunts.values()].filter((m) => !m.sinking));

function wantedHaunts() {
  const want = new Set();
  if (phase !== 'pick' || !area || map.getZoom() < HAUNT_ZOOM) return want;
  const chosen = start?.house == null ? -1 : area.houses.findIndex((h) => h.id === start.house);
  for (const i of [chosen, revealed.hover, previewing, ...revealed.apparitions]) if (i >= 0) want.add(i);
  return want;
}

function renderHaunts() {
  if (hauntsFor !== area) { layers.haunts.clearLayers(); haunts.clear(); revealed.apparitions.clear(); revealed.hover = -1; hauntsFor = area; }
  const want = wantedHaunts();
  hauntsHidden = phase === 'pick' && !!area?.houses.length && map.getZoom() < HAUNT_ZOOM;
  map.getContainer().style.setProperty('--hz', map.getZoom() >= 18 ? 1 : 0.85); // a touch smaller when they're packed in
  for (const [i, m] of haunts) if (!want.has(i) && !m.sinking) sink(i, m);
  for (const i of want) {
    const old = haunts.get(i);
    if (old?.sinking) { clearTimeout(old.sinking); old.sinking = 0; old.getElement()?.classList.remove('sinking'); }
    if (old) continue;
    const h = area.houses[i];
    const m = L.marker([h.lat, h.lon], { icon: hauntIcon(h.id), keyboard: false })
      .on('click', (e) => { L.DomEvent.stopPropagation(e); pickHouse(i); });
    if (canHover.matches && h.address) m.bindTooltip(esc(h.address), { direction: 'top' }); // on touch it would cover the pin
    haunts.set(i, m.addTo(layers.haunts));
  }
  for (const [i, m] of haunts) {
    const me = area.houses[i].id === start?.house, near = i === revealed.hover || i === previewing;
    m.getElement()?.classList.toggle('chosen', me);
    m.getElement()?.classList.toggle('near', near && !me && !m.sinking);
    m.setZIndexOffset(near ? 600 : me ? 500 : 0);
  }
  if (phase === 'pick' && !hauntsHidden && !reduced.matches) haunter.start(); else haunter.stop();
  if (phase === 'pick' && barState === 'start') pickbar();
}

// Back into the ground, then gone (unless it's wanted again first).
function sink(i, m) {
  const el = m.getElement();
  if (!el || reduced.matches) { m.remove(); haunts.delete(i); return; }
  el.classList.remove('near');
  el.classList.add('sinking');
  m.sinking = setTimeout(() => { m.remove(); if (haunts.get(i) === m) haunts.delete(i); }, 420);
}

// The house nearest the pointer rises (generously: within ~24 px of its middle).
let hoverRaf = 0;
map.on('mousemove', (e) => {
  if (phase !== 'pick' || !area || !canHover.matches) return;
  if (e.originalEvent.target.closest?.('.haunt')) return; // over a risen house: keep it
  cancelAnimationFrame(hoverRaf);
  hoverRaf = requestAnimationFrame(() => {
    const mPerPx = (40075016 * Math.cos((e.latlng.lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
    const i = map.getZoom() < HAUNT_ZOOM ? -1 : houseNear({ lat: e.latlng.lat, lon: e.latlng.lng }, 24 * mPerPx);
    if (i !== revealed.hover) { revealed.hover = i; renderHaunts(); }
  });
});
map.getContainer().addEventListener('mouseleave', () => { if (revealed.hover >= 0) { revealed.hover = -1; renderHaunts(); } });

// Apparitions: every so often a house on screen rises for a moment on its own (a few at most).
setInterval(() => {
  if (phase !== 'pick' || !area?.houses.length || reduced.matches || document.hidden || map.getZoom() < HAUNT_ZOOM) return;
  if (revealed.apparitions.size >= 3) return;
  const b = map.getBounds().pad(-0.12), pool = [];
  area.houses.forEach((h, i) => { if (b.contains([h.lat, h.lon]) && !haunts.has(i)) pool.push(i); });
  const i = pool[Math.floor(Math.random() * pool.length)];
  if (i === undefined) return;
  revealed.apparitions.add(i);
  renderHaunts();
  setTimeout(() => { revealed.apparitions.delete(i); renderHaunts(); }, 2400 + Math.random() * 1600);
}, 1300);
map.on('moveend', renderHaunts);
map.on('click', (e) => {
  if (phase === 'pick') pickSpot(e.latlng);
  else if (phase === 'idle' && map.getZoom() >= 15) chooseStart({ lat: e.latlng.lat, lon: e.latlng.lng });
});

function useArea(a) {
  area = a;
  if (housesFor !== area) buildHouses();
  area.houses.forEach(styleHouse);
  renderHaunts();
}

// Directions are tucked away unless someone wants them; remember their choice.
$('dirBox').open = localStorage.getItem('cm:dirOpen') === '1';
$('dirBox').addEventListener('toggle', () => localStorage.setItem('cm:dirOpen', $('dirBox').open ? '1' : '0'));

// Shareable links: ?address=…&min=90&walker=kid&door=30&compare=easy
const PARAMS = { address: 'address', min: 'budget', walker: 'pace', door: 'porch', compare: 'alt' };

function readUrl() {
  const q = new URLSearchParams(location.search);
  for (const [key, id] of Object.entries(PARAMS)) {
    const v = q.get(key);
    if (v === null) continue;
    const el = $(id);
    if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) continue;
    if (el.type === 'range') el.value = Math.min(+el.max, Math.max(+el.min, +v || +el.value));
    else el.value = v;
    el.dispatchEvent(new Event('input'));
  }
  // The exact start, so a shared link never re-geocodes somewhere slightly different.
  const at = (q.get('at') || '').split(',').map(Number);
  if (q.has('address') && at.length === 2 && at.every(Number.isFinite)) setStart({ lat: at[0], lon: at[1], label: $('address').value.trim() });
  return q.has('address') && $('address').value.trim();
}

function linkUrl() {
  const q = new URLSearchParams();
  for (const [key, id] of Object.entries(PARAMS)) q.set(key, key === 'address' ? $(id).value.trim() : $(id).value);
  if (start?.label === $('address').value.trim()) q.set('at', `${start.lat.toFixed(6)},${start.lon.toFixed(6)}`);
  return `${location.origin}${location.pathname}?${q}`;
}

function share() {
  return shareLink({ url: linkUrl(), title: 'Candy Maxxer route', button: $('share') });
}

function status(msg, isError = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
  $('status').toggleAttribute('data-peek', isError); // keep errors in view on a collapsed sheet
  if (isError) sheet.refresh();
  if (!isError) loader.stage(msg);
}

// Houses a plan of this length wants within reach before we stop widening the download.
// (The solver keeps ~5 per minute as candidates, but real routes visit about 1 per minute.)
const housesWanted = (budgetMin) => Math.max(150, budgetMin * 3);

const NO_HOUSES = 'OpenStreetMap doesn’t have any houses mapped around here yet, so there’s nowhere to trick-or-treat. 🕸️';
// A start this close to a loaded neighborhood's center reuses it: one ~200 m download cell, or
// more in a wide download, as long as ~600 m of it still lies beyond the start.
const REUSE_M = 200;
const covers = (a, pt) => !!a && metersApart(a.center, pt) <= Math.max(REUSE_M, (a.radius ?? 0) - 600);
const enough = (a, budgetMin) => a.fallback || a.radius >= RADII.at(-1) || a.houses.length >= housesWanted(budgetMin);

// Houses, streets and hills around center: the smallest download (above minRadius, up to
// maxRadius) that holds enough houses for a plan this long.
async function loadArea(center, budgetMin, minRadius = 0, maxRadius = Infinity) {
  loader.stage('Fetching houses & streets…', 0.3);
  const proj = makeProjection(center.lat, center.lon);
  let osm, ways, houses, downloaded = false, fallback = false;
  for (const r of RADII.filter((x) => x > minRadius && x <= maxRadius)) {
    osm = await loadOsm(center.lat, center.lon, r, status);
    downloaded ||= !osm.cached;
    fallback ||= !!osm.fallback;
    ({ ways, houses } = parseOsm(osm.data, proj));
    // Servers busy and we made do with a saved area: asking for a wider one would just wait again.
    if (fallback || houses.length >= housesWanted(budgetMin)) break;
  }
  if (!ways.length) throw new Error('No walkable streets found near there.');
  const net = buildNetwork(ways, proj);
  status(`Measuring hills under ${net.n.toLocaleString()} street points…`);
  loader.stage(`Measuring hills under ${net.n.toLocaleString()} street points…`, 0.4);
  const all = await elevations([...net.lat.map((la, i) => [la, net.lon[i]]), ...houses.map((h) => [h.lat, h.lon])]);
  const z = all.subarray(0, net.n), houseZ = all.subarray(net.n);
  levelStructures(net, z);
  return { center: { lat: center.lat, lon: center.lon }, proj, net, houses, z, houseZ, radius: osm.radius, downloaded, fallback };
}

// One load per neighborhood, shared by background prefetches, choosing and plans. quick: just
// the first download (enough to show the houses); otherwise widen until a plan this long fits.
let areaJob = null; // { center, promise, done }
function newJob(center, load) {
  const job = { center, done: false };
  job.promise = load().finally(() => { job.done = true; });
  return (areaJob = job);
}
async function areaFor(pt, budgetMin, { quick = false } = {}) {
  if (covers(area, pt) && (quick || enough(area, budgetMin))) return area;
  let job = covers(areaJob, pt) ? areaJob : newJob(pt, () => loadArea(pt, budgetMin, 0, quick ? RADII[0] : Infinity));
  for (;;) {
    let a;
    try { a = await job.promise; } catch (e) { if (areaJob === job) areaJob = null; throw e; }
    if (quick || enough(a, budgetMin)) return a;
    job = areaJob !== job && covers(areaJob, pt) ? areaJob : newJob(a.center, () => loadArea(a.center, budgetMin, a.radius));
  }
}

// Start loading a typed address in the background so its first plan has less to wait for.
function prefetch() {
  const address = $('address').value.trim();
  if (!address || address === start?.label) return;
  geocode(address).then((g) => areaFor(g, +$('budget').value)).catch(() => { /* the real plan will retry and report */ });
}

async function run() {
  const address = $('address').value.trim();
  if (!address) return;
  const budgetMin = +$('budget').value;
  const picked = start?.label === address ? start : null; // otherwise they typed somewhere new
  const gen = resets; // started over while this was loading? then drop it
  $('go').disabled = $('planHere').disabled = true;
  // Already loaded, or a background load finished? Then there's nothing to wait for but the
  // solver, and the celebration can be quick.
  const loaded = !!picked && covers(area, picked) && enough(area, budgetMin);
  const ready = loaded || (!!picked && covers(areaJob, picked) && areaJob.done);
  // A settings tweak or a dragged start re-plans with the map in view; anything else gets the full show.
  const quiet = loaded && phase === 'plan';
  progressBase = ready ? 0 : 0.42;
  if (!quiet) {
    loader.show();
    document.activeElement?.blur(); // drop the phone keyboard
  }
  try {
    let s = picked;
    if (!s) {
      status('Finding address…');
      loader.stage('Finding address…', 0.05);
      const g = await geocode(address);
      if (gen !== resets) return;
      s = { lat: g.lat, lon: g.lon, label: address };
      setStart(s);
    }
    const next = await areaFor(s, budgetMin);
    if (gen !== resets) return;
    fitNext ||= next !== area || phase !== 'plan';
    useArea(next);
    const snap = area.net.anchor(...area.proj.toXY(s.lat, s.lon), 400);
    if (!snap) throw new Error('That spot is too far from any walkable street.');
    area.startNode = snap.id;
    if (!area.houses.length) throw new Error(NO_HOUSES);
    await solveAndDraw(budgetMin, { quiet, quick: ready || !area.downloaded });
  } catch (e) {
    if (gen !== resets) return;
    console.error(e);
    status(e.message, true);
    loader.hide();
  } finally {
    $('go').disabled = $('planHere').disabled = false;
  }
}

// Dim the routes and show a small chip while a quick re-plan runs (only if it isn't instant).
let replanTimer = 0;
function replanning(on) {
  clearTimeout(replanTimer);
  document.body.classList.toggle('replanning', on);
  for (const l of routeLines) l.setStyle({ opacity: on ? l.baseOpacity * 0.35 : l.baseOpacity });
  if (on) replanTimer = setTimeout(() => { $('replan').hidden = false; }, 150);
  else $('replan').hidden = true;
}

async function solveAndDraw(budgetMin, { quiet = !!shown, quick = true } = {}) {
  const pace = PACES[$('pace').value];
  const porchSec = +$('porch').value;
  const { net, houses, z, houseZ, startNode } = area;
  const g = buildCSR(net, z, pace);
  const hs = attachHouses(net, houses, houseZ, z, { pace, porchSec });
  for (const h of hs) h.value = candyValue(h, overrides[h.id]);

  if (quiet) replanning(true);
  else loader.show();
  status($('alt').value === 'none' ? 'Planning the sweetest route…' : 'Planning two routes to compare…');
  const seq = ++solveSeq;
  let res;
  try {
    res = await new Promise((resolve) => {
      pending.set(seq, resolve);
      worker.postMessage({
        seq, g, startNode, budgetSec: budgetMin * 60, alt: $('alt').value,
        houses: hs.map(({ index, node, doorSec, value }) => ({ index, node, doorSec, value })),
      });
    });
  } finally {
    if (seq === solveSeq) replanning(false);
  }
  if (seq !== solveSeq) return;
  if (!res.ok) throw new Error(res.error);
  shown = { g, routes: res.routes, budgetMin };
  if (phase !== 'plan') leavePick();
  focus = Math.min(focus, res.routes.length - 1);
  progressBase = 0;
  if (!quiet) {
    await loader.finish(res.routes[0].candy, { quick });
    if (seq !== solveSeq) return;
    sheet.to('peek');
    editing(false);
  }
  draw({ reveal: !quiet, tween: quiet });
  status(`Weighed up ${res.routes[0].considered} nearby houses in ${(res.ms / 1000).toFixed(1)} s.` +
    (area.fallback ? ' Map servers were busy, so this used a saved nearby area: it may miss a few streets.' : ''));
  history.replaceState(null, '', linkUrl());
}

// Per-route geometry: map points (one per edge walked, plus home) and the elevation profile.
function geometry(g, route) {
  const { net, z, startNode } = area;
  const pts = [[net.lat[startNode], net.lon[startNode]]];
  const prof = [{ d: 0, z: z[startNode], lat: net.lat[startNode], lon: net.lon[startNode] }];
  let d = 0;
  for (const leg of route.legs) for (const k of leg) {
    const b = g.to[k];
    d += g.len[k];
    pts.push([net.lat[b], net.lon[b]]);
    prof.push({ d, z: z[b], lat: net.lat[b], lon: net.lon[b] });
  }
  return { pts, prof };
}

// Houses: built once per neighborhood, then restyled for each plan.
function buildHouses() {
  layers.houses.clearLayers();
  housePolys = area.houses.map((h, i) => L.polygon(h.outline, { weight: 1 })
    .bindTooltip(() => houseTip(h, i), { sticky: true })
    .on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (phase === 'plan') toggleHouse(h, i);
      else if (phase === 'pick') pickHouse(i);
      else chooseStart({ lat: h.lat, lon: h.lon, house: h.id }); // after starting over
    })
    .addTo(layers.houses));
  housesFor = area;
}

function houseTip(h, i) {
  const ov = overrides[h.id];
  const tag = ov === 'star' ? ' ⭐' : ov === 'dark' ? ' 🌑' : '';
  if (!shown) return `<b>${esc(h.address || 'House')}${tag}</b><br>Tap to start here`;
  const stops = shown.routes.map((r, ri) => stopOrder[ri]?.get(i) && `Stop ${stopOrder[ri].get(i)} on ${r.label}`).filter(Boolean);
  return `<b>${h.address || 'House'}${tag}</b>${stops.map((t) => `<br>${t}`).join('')}`;
}

// The followed route's stops fill in its color; the other route's stops get a faint tint.
function styleHouse(h, i) {
  const ov = overrides[h.id] || 'normal';
  const mine = stopOrder[focus]?.get(i);
  const other = shown?.routes.length > 1 ? stopOrder[1 - focus]?.get(i) : undefined;
  let fill = '#5b536c', opacity = phase === 'pick' ? 0.5 : 0.35;
  if (phase !== 'plan' && h.id === start?.house) { fill = '#ffb347'; opacity = 0.5; } // a warm wash under its haunted house
  else if (ov === 'dark') { fill = '#3a3448'; opacity = 0.9; }
  else if (ov === 'star') { fill = '#f5c542'; opacity = 0.9; }
  else if (mine) { fill = ROUTE_COLORS[focus]; opacity = 0.9; }
  else if (other) { fill = ROUTE_COLORS[1 - focus]; opacity = 0.45; }
  housePolys[i].setStyle({ color: fill, fillColor: fill, fillOpacity: opacity });
}

// Cycle normal → ⭐ → 🌑: show it on the house right away, then re-plan around it.
function toggleHouse(h, i) {
  const ov = overrides[h.id] || 'normal';
  const next = OVERRIDES[(OVERRIDES.indexOf(ov) + 1) % OVERRIDES.length];
  if (next === 'normal') delete overrides[h.id]; else overrides[h.id] = next;
  localStorage.setItem('cm:overrides', JSON.stringify(overrides));
  styleHouse(h, i);
  const mark = L.marker([h.lat, h.lon], {
    icon: L.divIcon({ className: 'mark-icon', html: `<span class="mark-pop">${{ star: '⭐', dark: '🌑', normal: '🍬' }[next]}</span>`, iconSize: [30, 30] }),
    interactive: false, keyboard: false,
  }).addTo(map);
  setTimeout(() => mark.remove(), 1000);
  solveAndDraw(+$('budget').value).catch((e) => { status(e.message, true); loader.hide(); });
}

function draw({ reveal = false, tween = false } = {}) {
  const { g, routes, budgetMin } = shown;
  const geo = routes.map((r) => geometry(g, r));
  const color = (i) => ROUTE_COLORS[i];
  stopOrder = routes.map((r) => new Map(r.stops.map((idx, i) => [idx, i + 1])));

  // Summary first, so the sheet is measured with it before the map fits the routes above it.
  document.body.classList.add('has-plan');
  editing(document.body.classList.contains('editing'));
  planSummary();
  $('addrField').removeAttribute('data-peek');
  renderPeek(routes, tween);
  renderCompare(routes, budgetMin, tween);
  $('results').hidden = false;
  sheet.refresh();

  if (housesFor !== area) buildHouses();
  area.houses.forEach(styleHouse);

  // Routes: the other one dimmed and dashed underneath; the followed one on top with arrows.
  layers.route.clearLayers();
  layers.arrows.clearLayers();
  const drawOrder = routes.map((_, i) => i).sort((a, b) => (a === focus) - (b === focus));
  const lines = [];
  for (const i of drawOrder) {
    const on = i === focus;
    if (on) {
      lines.push(L.polyline(geo[i].pts, { color: color(i), weight: 16, opacity: 0.16, interactive: false }).addTo(layers.route)); // glow
      lines.push(L.polyline(geo[i].pts, { color: '#000', weight: 8, opacity: 0.45, interactive: false }).addTo(layers.route));
    }
    lines.push(L.polyline(geo[i].pts, {
      color: color(i), weight: on ? 4 : 3, opacity: on ? 1 : 0.6, dashArray: on ? null : '6 6',
    }).on('click', () => setFocus(i)).addTo(layers.route));
  }
  for (const l of lines) l.baseOpacity = l.options.opacity;
  routeLines = lines;
  if (fitNext) {
    fitNext = false;
    map.fitBounds(L.latLngBounds(geo.flatMap((x) => x.pts)), { ...fitPad(30), maxZoom: 17, animate: false });
  }
  const arrows = () => {
    if (!reduced.matches) flowLayer(map, geo[focus].pts).addTo(layers.arrows);
    arrowLayer(map, geo[focus].pts, color(focus), { pop: true, avoid: turns.map((t) => geo[focus].pts[t.j]) }).addTo(layers.arrows);
  };
  const turns = turnaroundPoints(buildSteps(g, area.net, routes[focus].legs)).map((j) => ({
    j, done: false,
    mark: L.marker(geo[focus].pts[j], {
      icon: L.divIcon({ className: 'uturn-icon', html: `<span>${uturnSvg(color(focus))}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      keyboard: false,
    }).bindTooltip('Turn around here and head back'),
  }));
  const showTurns = (n = Infinity) => { for (const t of turns) if (!t.done && t.j < n) { t.done = true; t.mark.addTo(layers.arrows); } };
  const home = L.marker([start.lat, start.lon], {
    icon: L.divIcon({ className: 'home-icon', html: HOME_SVG, iconSize: [32, 32], iconAnchor: [16, 16] }),
    zIndexOffset: 1000, draggable: true, keyboard: false,
  }).bindTooltip(`Start & finish: ${esc(start.label)}<br><small>Drag to move it</small>`);
  dragPreview(home);
  home.on('dragend', (e) => pickSpot(e.target.getLatLng(), { replan: true }));
  const arrive = (celebrate) => home.getElement()?.classList.add('arrived', ...(celebrate ? ['arriving'] : []));
  if (reveal && !reduced.matches) {
    // Porch lights: each stop on the followed route waits dark until the line reaches it.
    const r = routes[focus], lit = [];
    let cum = 0;
    r.legs.forEach((leg, k) => { cum += leg.length; if (k < r.stops.length) lit.push([r.stops[k], cum]); });
    for (const [idx] of lit) housePolys[idx].setStyle({ color: '#5b536c', fillColor: '#5b536c', fillOpacity: 0.35 });
    let next = 0;
    const reached = (n) => {
      showTurns(n);
      for (; next < lit.length && lit[next][1] < n; next++) {
        const idx = lit[next][0];
        housePolys[idx].setStyle({ color: '#ffd36b', fillColor: '#ffd36b', fillOpacity: 1 });
        setTimeout(() => styleHouse(area.houses[idx], idx), 350);
      }
    };
    home.addTo(layers.route);
    drawIn(lines, geo[focus].pts.length, reached, () => { arrows(); arrive(true); pill.nudge(); });
  }
  else { arrows(); showTurns(); home.addTo(layers.route); arrive(false); if (reveal) pill.nudge(); }

  renderProfile($('profile'), routes.map((r, i) => ({ label: r.label, color: color(i), focused: i === focus, pts: geo[i].prof })), {
    onHover: (hits) => {
      layers.cursor.clearLayers();
      for (const p of hits) L.circleMarker([p.lat, p.lon], { radius: 6, color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 1 }).addTo(layers.cursor);
    },
  });
  renderDirections(g, routes[focus], geo[focus]);
}

// Walk the route onto the map: every line grows from home along its path, then the arrows pop in.
// onReach(n) hears how many points of the followed route (`focusLen` long) are drawn so far.
function drawIn(lines, focusLen, onReach, then) {
  const full = lines.map((l) => l.getLatLngs().slice());
  const longest = Math.max(...full.map((f) => f.length));
  const ms = Math.min(1800, Math.max(700, longest * 3));
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - t) ** 3; // ease-out
    lines.forEach((l, i) => l.setLatLngs(full[i].slice(0, Math.max(2, Math.ceil(full[i].length * e)))));
    onReach(Math.ceil(focusLen * e));
    if (t < 1) requestAnimationFrame(step);
    else then();
  };
  lines.forEach((l) => l.setLatLngs(full[lines.indexOf(l)].slice(0, 2)));
  requestAnimationFrame(step);
}

function setFocus(i) {
  if (i === focus || !shown || i >= shown.routes.length) return;
  focus = i;
  draw();
}

// Numbers that changed in a re-plan count to their new value and flash, so you can see what moved.
const lastVals = new Map();
const num = (key, v, dec = 0) => `<span class="num" data-k="${key}" data-v="${v}" data-dec="${dec}">${v.toFixed(dec)}</span>`;

function countUp(root, tween) {
  for (const el of root.querySelectorAll('.num')) {
    const { k, dec } = el.dataset, to = +el.dataset.v, from = lastVals.get(k);
    lastVals.set(k, to);
    if (!tween || from === undefined || from.toFixed(dec) === to.toFixed(dec)) continue;
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 700);
    if (reduced.matches) continue;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 600), e = 1 - (1 - t) ** 3;
      el.textContent = (from + (to - from) * e).toFixed(dec);
      if (t < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = from.toFixed(dec);
    requestAnimationFrame(step);
  }
}

// The collapsed sheet on phones: the haul, the gist, and which route to follow.
function renderPeek(routes, tween) {
  const r = routes[focus];
  $('peek').innerHTML = `<div class="pk-haul"><span class="pk-candy">≈ ${num(`peek:${r.key}`, Math.round(r.candy))}</span>
      <span class="pk-unit">pieces</span></div>
    <div class="pk-stats">${r.stops.length} houses · ${(r.distM / M_PER_MI).toFixed(2)} mi · ${Math.round(r.totalSec / 60)} min · ${Math.round(r.climbM * FT_PER_M)} ft climb</div>
    ${routes.length > 1 ? `<div class="pk-routes">${routes.map((x, i) => `<button type="button" class="route-chip${i === focus ? ' active' : ''}" data-i="${i}" aria-pressed="${i === focus}">
      <i style="background:${ROUTE_COLORS[i]}"></i>${x.label}</button>`).join('')}</div>` : ''}`;
  $('peek').querySelectorAll('.route-chip').forEach((b) => b.addEventListener('click', () => setFocus(+b.dataset.i)));
  countUp($('peek'), tween);
}

// Route cards: the haul up top, the gist below; the second card shows how it differs from the first.
function renderCompare(routes, budgetMin, tween) {
  const two = routes.length > 1;
  // [label, value, decimals, suffix]
  const stats = [
    ['Houses', (r) => r.stops.length, 0, ''],
    ['Walking', (r) => r.distM / M_PER_MI, 2, ' mi'],
    ['Climb', (r) => Math.round(r.climbM * FT_PER_M), 0, ' ft'],
    ['Time', (r) => Math.round(r.totalSec / 60), 0, ' min'],
  ];
  const delta = (a, b) => {
    if (!a) return '';
    const pct = Math.round(((b - a) / a) * 100);
    return `<small class="delta">${pct ? `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` : 'same'}</small>`;
  };
  const vs = (i, a, b) => (two && i === 1 ? delta(a, b) : '');
  const cards = routes.map((r, i) => `<button type="button" class="rcard${i === focus ? ' active' : ''}" data-i="${i}"
      aria-pressed="${i === focus}" style="--c:${ROUTE_COLORS[i]}">
    <span class="rc-label"><i></i>${r.label}</span>
    <span class="rc-haul"><span class="rc-candy">${num(`Candy:${r.key}`, Math.round(r.candy))}</span>
      <span class="rc-unit">pieces ${vs(i, routes[0].candy, r.candy)}</span></span>
    <span class="rc-rate">${num(`Rate:${r.key}`, r.candy / (r.totalSec / 60) || 0, 1)} / min</span>
    <span class="rc-stats">${stats.map(([label, val, dec, post]) => `<span><span class="k">${label}</span>
      <span class="v">${num(`${label}:${r.key}`, val(r), dec)}${post}${vs(i, val(routes[0]), val(r))}</span></span>`).join('')}</span>
  </button>`).join('');
  const note = routes[0].note || (routes[1]?.key === 'more' ? `${routes[1].label} walks for up to ${budgetMin + 30} min.` : '');
  $('compare').innerHTML = `<div class="rcards${two ? ' two' : ''}">${cards}</div>${note ? `<p class="note">${note}</p>` : ''}`;
  $('compare').querySelectorAll('.rcard').forEach((b) => b.addEventListener('click', () => setFocus(+b.dataset.i)));
  countUp($('compare'), tween);
}

function renderDirections(g, route, geo) {
  const steps = buildSteps(g, area.net, route.legs);
  $('dirTitle').textContent = shown.routes.length > 1 ? `🧭 Turn-by-turn: ${route.label}` : '🧭 Turn-by-turn directions';
  $('dirCount').textContent = `${steps.length + 1} steps`;
  const list = $('directions');
  list.innerHTML = steps.map((s) => `<li>${stepText(s)} <small>${Math.round(s.m * FT_PER_M).toLocaleString()} ft${
    s.houses ? ` · ${s.houses} house${s.houses > 1 ? 's' : ''}` : ''}</small></li>`).join('') + '<li>Arrive home 🏠</li>';
  // Hover a step to light it up on the map; tap one to fly there and keep it lit. Steps split the
  // walked edges in order, so step i spans points [edges before it, edges before it + its own].
  layers.highlight.clearLayers();
  const light = (span) => {
    layers.highlight.clearLayers();
    if (span && span[1] > span[0]) L.polyline(geo.pts.slice(span[0], span[1] + 1), { color: '#fff', weight: 7, opacity: 0.9, interactive: false }).addTo(layers.highlight);
  };
  let first = 0, picked = null;
  [...list.children].forEach((li, i) => {
    const s = steps[i];
    const span = [first, first + (s?.edges.length ?? 0)];
    first = span[1];
    li.addEventListener('mouseenter', () => light(span));
    li.addEventListener('mouseleave', () => light(picked));
    li.addEventListener('click', () => {
      list.querySelector('.on')?.classList.remove('on');
      li.classList.add('on');
      picked = span;
      light(span);
      if (span[1] === span[0]) return;
      if (sheet.snap === 'full') sheet.to('half'); // leave some map to fly to
      map.flyToBounds(L.latLngBounds(geo.pts.slice(span[0], span[1] + 1)), {
        ...fitPad(40), maxZoom: 18, duration: 0.6,
      });
    });
  });
}

// Start from a shared link if there is one; then wherever they last started; otherwise find them
// (falling back to the default address).
const saved = (() => { try { return JSON.parse(localStorage.getItem(START_KEY)); } catch { return null; } })();
if (readUrl()) run();
else if (saved?.label && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) chooseStart(saved);
else useMyLocation(true);
