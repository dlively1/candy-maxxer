// Wires the pipeline to the page: geocode → OSM → elevation → graph → solver worker → map.

import { geocode } from './geocode.js';
import { fetchOsm, parseOsm } from './osm.js';
import { elevations } from './elevation.js';
import { makeProjection } from './geo.js';
import { buildNetwork, buildCSR, attachHouses, levelStructures } from './graph.js';
import { candyValue, OVERRIDES } from './candy.js';
import { PACES } from './tobler.js';
import { renderProfile } from './profile.js';
import { arrowLayer } from './arrows.js';
import { buildSteps, stepText } from './directions.js';
import { createLoader } from './loader.js';
import { shareLink } from './share.js';
import { initPill } from './pill.js';
import { addressBox, locate } from './address.js';
import { initSheet } from './sheet.js';

const $ = (id) => document.getElementById(id);
const M_PER_MI = 1609.344, FT_PER_M = 3.28084;
const ROUTE_COLORS = ['#de7218', '#358de8']; // validated pair: distinct under color-vision deficiency
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

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

let area = null;     // loaded neighborhood: { address, start, proj, net, houses, z, houseZ, startNode }
let solveSeq = 0;
let shown = null;    // last plan: { g, routes, budgetMin }
let focus = 0;       // which route the directions / arrows follow
let fitNext = false; // zoom to the routes on the first plan for a new address
let stopOrder = [];  // per route on screen: Map house index → stop number
let housePolys = []; // one polygon per house in `area`, restyled (not rebuilt) as plans change
let housesFor = null;
let routeLines = []; // drawn route polylines, dimmed while a re-plan is running

for (const [inp, out, fmt] of [['budget', 'budgetOut', (v) => `${v} min`], ['porch', 'porchOut', (v) => `${v} s`]]) {
  $(inp).addEventListener('input', () => { $(out).value = fmt($(inp).value); });
}
for (const id of ['budget', 'pace', 'porch', 'alt']) $(id).addEventListener('change', () => area && run());
$('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
$('share').addEventListener('click', share);
const pill = initPill(map, $('share'));
const sheet = initSheet($('panel'), $('grab'));
if (sheet.mobile) map.attributionControl.setPosition('topright'); // the sheet covers the bottom of the map
$('address').addEventListener('focus', () => sheet.to('full'));

// A spot we already have coordinates for (a picked suggestion or "my location"): skip geocoding.
let pinned = null; // { address, lat, lon }
const pin = (address, lat, lon) => { pinned = lat == null ? null : { address, lat, lon }; };
addressBox({
  input: $('address'),
  list: $('addr-list'),
  getBias: () => pinned || area?.start || (({ lat, lng }) => ({ lat, lon: lng }))(map.getCenter()),
  onPick: (it) => { pin(it.label, it.lat, it.lon); run(); },
});
$('locate').addEventListener('click', () => useMyLocation(false));

async function useMyLocation(quiet) {
  const btn = $('locate');
  btn.classList.add('busy');
  try {
    const here = await locate();
    $('address').value = here.label;
    pin(here.label, here.lat, here.lon);
    run();
  } catch (e) {
    // Denied, unavailable, or timed out: the default address is still there to use.
    if (!quiet) status(e.code === 1 ? 'Location is blocked: allow it in your browser settings, or type an address.' : 'Couldn’t find you. Type an address instead.', true);
  } finally {
    btn.classList.remove('busy');
  }
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
  return q.has('address') && $('address').value.trim();
}

function linkUrl() {
  const q = new URLSearchParams();
  for (const [key, id] of Object.entries(PARAMS)) q.set(key, key === 'address' ? $(id).value.trim() : $(id).value);
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

// One fetch per address. At ~1 min per house, 1 km holds far more houses than even 3 hours can visit.
const RADIUS_M = 1000;

async function loadArea(address) {
  status('Finding address…');
  loader.stage('Finding address…', 0.05);
  const start = pinned?.address === address ? { lat: pinned.lat, lon: pinned.lon, label: address } : await geocode(address);
  loader.stage('Fetching houses & streets…', 0.3);
  const osm = await fetchOsm(start.lat, start.lon, RADIUS_M, status);
  const proj = makeProjection(start.lat, start.lon);
  const { ways, houses } = parseOsm(osm, proj);
  if (!ways.length) throw new Error('No walkable streets found near that address.');
  const net = buildNetwork(ways, proj);
  status(`Measuring hills under ${net.n.toLocaleString()} street points…`);
  loader.stage(`Measuring hills under ${net.n.toLocaleString()} street points…`, 0.4);
  const all = await elevations([...net.lat.map((la, i) => [la, net.lon[i]]), ...houses.map((h) => [h.lat, h.lon])]);
  const z = all.subarray(0, net.n), houseZ = all.subarray(net.n);
  levelStructures(net, z);
  const snap = net.grid.nearest(0, 0, 400, net.walkable);
  if (!snap) throw new Error('That address is too far from any walkable street.');
  return { address, start, proj, net, houses, z, houseZ, startNode: snap.id };
}

async function run() {
  const address = $('address').value.trim();
  const budgetMin = +$('budget').value;
  // A new place gets the full show; a settings tweak on the same place re-plans with the map in view.
  const fresh = !area || area.address !== address || !shown;
  $('go').disabled = true;
  progressBase = 0;
  if (fresh) {
    loader.show();
    document.activeElement?.blur(); // drop the phone keyboard
  }
  try {
    if (!area || area.address !== address) {
      area = await loadArea(address);
      fitNext = true;
      progressBase = 0.42;
    }
    await solveAndDraw(budgetMin, { quiet: !fresh });
  } catch (e) {
    console.error(e);
    status(e.message, true);
    loader.hide();
  } finally {
    $('go').disabled = false;
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

async function solveAndDraw(budgetMin, { quiet = !!shown } = {}) {
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
  focus = Math.min(focus, res.routes.length - 1);
  progressBase = 0;
  if (!quiet) {
    await loader.finish(res.routes[0].candy);
    if (seq !== solveSeq) return;
    sheet.to('peek');
  }
  draw({ reveal: !quiet, tween: quiet });
  status(`Weighed up ${res.routes[0].considered} nearby houses in ${(res.ms / 1000).toFixed(1)} s.`);
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
    .on('click', () => toggleHouse(h, i))
    .addTo(layers.houses));
  housesFor = area;
}

function houseTip(h, i) {
  const ov = overrides[h.id];
  const tag = ov === 'star' ? ' ⭐' : ov === 'dark' ? ' 🌑' : '';
  const stops = shown.routes.map((r, ri) => stopOrder[ri]?.get(i) && `Stop ${stopOrder[ri].get(i)} on ${r.label}`).filter(Boolean);
  return `<b>${h.address || 'House'}${tag}</b>${stops.map((t) => `<br>${t}`).join('')}`;
}

// The followed route's stops fill in its color; the other route's stops get a faint tint.
function styleHouse(h, i) {
  const ov = overrides[h.id] || 'normal';
  const mine = stopOrder[focus]?.get(i);
  const other = shown.routes.length > 1 ? stopOrder[1 - focus]?.get(i) : undefined;
  let fill = '#5b536c', opacity = 0.35;
  if (ov === 'dark') { fill = '#3a3448'; opacity = 0.9; }
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
  const { start } = area;
  const geo = routes.map((r) => geometry(g, r));
  const color = (i) => ROUTE_COLORS[i];
  stopOrder = routes.map((r) => new Map(r.stops.map((idx, i) => [idx, i + 1])));

  // Summary first, so the sheet is measured with it before the map fits the routes above it.
  document.body.classList.add('has-plan');
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
    map.fitBounds(L.latLngBounds(geo.flatMap((x) => x.pts)), {
      paddingTopLeft: [30, 30], paddingBottomRight: [30, 30 + sheet.visible()], maxZoom: 17, animate: false,
    });
  }
  const arrows = () => arrowLayer(map, geo[focus].pts, color(focus), { pop: true }).addTo(layers.arrows);
  if (reveal && !reduced.matches) drawIn(lines, () => { arrows(); pill.nudge(); });
  else { arrows(); if (reveal) pill.nudge(); }
  L.marker([start.lat, start.lon], {
    icon: L.divIcon({ className: 'home-icon', html: '🏠', iconSize: [28, 28], iconAnchor: [14, 14] }),
  }).bindTooltip(`Start & finish: ${start.label}`).addTo(layers.route);

  renderProfile($('profile'), routes.map((r, i) => ({ label: r.label, color: color(i), focused: i === focus, pts: geo[i].prof })), {
    onHover: (hits) => {
      layers.cursor.clearLayers();
      for (const p of hits) L.circleMarker([p.lat, p.lon], { radius: 6, color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 1 }).addTo(layers.cursor);
    },
  });
  renderDirections(g, routes[focus], geo[focus]);
}

// Walk the route onto the map: every line grows from home along its path, then the arrows pop in.
function drawIn(lines, then) {
  const full = lines.map((l) => l.getLatLngs().slice());
  const longest = Math.max(...full.map((f) => f.length));
  const ms = Math.min(1800, Math.max(700, longest * 3));
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - t) ** 3; // ease-out
    lines.forEach((l, i) => l.setLatLngs(full[i].slice(0, Math.max(2, Math.ceil(full[i].length * e)))));
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

function renderCompare(routes, budgetMin, tween) {
  const two = routes.length > 1;
  // [label, value, decimals, prefix, suffix, hero]
  const rows = [
    ['Candy', (r) => Math.round(r.candy), 0, '≈ ', '', true],
    ['Houses', (r) => r.stops.length, 0, '', ''],
    ['Walking', (r) => r.distM / M_PER_MI, 2, '', ' mi'],
    ['Climb', (r) => Math.round(r.climbM * FT_PER_M), 0, '', ' ft'],
    ['Time', (r) => Math.round(r.totalSec / 60), 0, '', ' min'],
    ['Pieces / min', (r) => r.candy / (r.totalSec / 60) || 0, 1, '', ''],
  ];
  const delta = (a, b) => {
    if (!a) return '';
    const pct = Math.round(((b - a) / a) * 100);
    return pct ? `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` : 'same';
  };
  const head = routes.map((r, i) => `<th><button class="route-tab${i === focus ? ' active' : ''}" data-i="${i}" aria-pressed="${i === focus}">
      <i style="background:${ROUTE_COLORS[i]}"></i>${r.label}</button></th>`).join('');
  const body = rows.map(([label, val, dec, pre, post, hero]) => `<tr${hero ? ' class="hero"' : ''}><th>${label}</th>${routes.map((r, i) =>
    `<td>${pre}${num(`${label}:${r.key}`, val(r), dec)}${post}${two && i === 1 ? `<small>${delta(val(routes[0]), val(r))}</small>` : ''}</td>`).join('')}</tr>`).join('');
  const note = routes[0].note || (routes[1]?.key === 'more' ? `${routes[1].label} walks for up to ${budgetMin + 30} min.` : '');
  $('compare').innerHTML = `<table class="compare"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>
    ${note ? `<p class="note">${note}</p>` : ''}`;
  $('compare').querySelectorAll('.route-tab').forEach((b) => b.addEventListener('click', () => setFocus(+b.dataset.i)));
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
        paddingTopLeft: [40, 40], paddingBottomRight: [40, 40 + sheet.visible()], maxZoom: 18, duration: 0.6,
      });
    });
  });
}

// Start from a shared link if there is one; otherwise try "here", falling back to the default address.
if (readUrl()) run();
else useMyLocation(true);
