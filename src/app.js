// Wires the pipeline to the page: geocode → OSM → elevation → graph → solver worker → map.

import { geocode } from './geocode.js';
import { fetchOsm, parseOsm } from './osm.js';
import { elevations } from './elevation.js';
import { makeProjection } from './geo.js';
import { buildNetwork, buildCSR, attachHouses } from './graph.js';
import { candyValue, OVERRIDES } from './candy.js';
import { PACES } from './tobler.js';
import { renderProfile } from './profile.js';
import { arrowLayer } from './arrows.js';
import { buildSteps, stepText } from './directions.js';

const $ = (id) => document.getElementById(id);
const M_PER_MI = 1609.344, FT_PER_M = 3.28084;
const ROUTE_COLORS = ['#de7218', '#358de8']; // validated pair: distinct under color-vision deficiency

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
const pending = new Map();
worker.onmessage = ({ data }) => { pending.get(data.seq)?.(data); pending.delete(data.seq); };
const overrides = JSON.parse(localStorage.getItem('cm:overrides') || '{}');

let area = null;     // loaded neighborhood: { address, start, proj, net, houses, z, houseZ, startNode }
let solveSeq = 0;
let shown = null;    // last plan: { g, routes, budgetMin }
let focus = 0;       // which route the directions / arrows follow
let fitNext = false; // zoom to the routes on the first plan for a new address

for (const [inp, out, fmt] of [['budget', 'budgetOut', (v) => `${v} min`], ['porch', 'porchOut', (v) => `${v} s`]]) {
  $(inp).addEventListener('input', () => { $(out).value = fmt($(inp).value); });
}
for (const id of ['budget', 'pace', 'porch', 'alt']) $(id).addEventListener('change', () => area && run());
$('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
$('share').addEventListener('click', share);

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

async function share() {
  const url = linkUrl();
  try {
    if (navigator.share) await navigator.share({ title: 'Candy Maxxer route', url });
    else { await navigator.clipboard.writeText(url); flash('Link copied!'); }
  } catch { /* share sheet dismissed */ }
}

function flash(msg) {
  const b = $('share'), old = b.textContent;
  b.textContent = msg;
  setTimeout(() => { b.textContent = old; }, 1500);
}

function status(msg, isError = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
}

// One fetch per address. At ~1 min per house, 1 km holds far more houses than even 3 hours can visit.
const RADIUS_M = 1000;

async function loadArea(address) {
  status('Finding address…');
  const start = await geocode(address);
  const osm = await fetchOsm(start.lat, start.lon, RADIUS_M, status);
  const proj = makeProjection(start.lat, start.lon);
  const { ways, houses } = parseOsm(osm, proj);
  if (!ways.length) throw new Error('No walkable streets found near that address.');
  const net = buildNetwork(ways, proj);
  status(`Measuring hills under ${net.n.toLocaleString()} street points…`);
  const all = await elevations([...net.lat.map((la, i) => [la, net.lon[i]]), ...houses.map((h) => [h.lat, h.lon])]);
  const z = all.subarray(0, net.n), houseZ = all.subarray(net.n);
  const snap = net.grid.nearest(0, 0, 400);
  if (!snap) throw new Error('That address is too far from any walkable street.');
  return { address, start, proj, net, houses, z, houseZ, startNode: snap.id };
}

async function run() {
  const address = $('address').value.trim();
  const budgetMin = +$('budget').value;
  $('go').disabled = true;
  try {
    if (!area || area.address !== address) {
      area = await loadArea(address);
      fitNext = true;
    }
    await solveAndDraw(budgetMin);
  } catch (e) {
    console.error(e);
    status(e.message, true);
  } finally {
    $('go').disabled = false;
  }
}

async function solveAndDraw(budgetMin) {
  const pace = PACES[$('pace').value];
  const porchSec = +$('porch').value;
  const { net, houses, z, houseZ, startNode } = area;
  const g = buildCSR(net, z, pace);
  const hs = attachHouses(net, houses, houseZ, z, { pace, porchSec });
  for (const h of hs) h.value = candyValue(h, overrides[h.id]);

  status($('alt').value === 'none' ? 'Planning the sweetest route…' : 'Planning two routes to compare…');
  const seq = ++solveSeq;
  const res = await new Promise((resolve) => {
    pending.set(seq, resolve);
    worker.postMessage({
      seq, g, startNode, budgetSec: budgetMin * 60, alt: $('alt').value,
      houses: hs.map(({ index, node, doorSec, value }) => ({ index, node, doorSec, value })),
    });
  });
  if (seq !== solveSeq) return;
  if (!res.ok) throw new Error(res.error);
  shown = { g, routes: res.routes, budgetMin };
  focus = Math.min(focus, res.routes.length - 1);
  draw();
  status(`Checked ${res.routes[0].considered} reachable houses in ${(res.ms / 1000).toFixed(1)} s.`);
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

function draw() {
  const { g, routes, budgetMin } = shown;
  const { houses, start } = area;
  const geo = routes.map((r) => geometry(g, r));
  const order = routes.map((r) => new Map(r.stops.map((idx, i) => [idx, i + 1])));
  const color = (i) => ROUTE_COLORS[i];

  // Houses: the followed route's stops fill in its color; the other route's stops get a faint tint.
  layers.houses.clearLayers();
  houses.forEach((h, i) => {
    const ov = overrides[h.id] || 'normal';
    const mine = order[focus].get(i);
    const other = routes.length > 1 ? order[1 - focus].get(i) : undefined;
    let fill = '#5b536c', opacity = 0.35;
    if (ov === 'dark') { fill = '#3a3448'; opacity = 0.9; }
    else if (ov === 'star') { fill = '#f5c542'; opacity = 0.9; }
    else if (mine) { fill = color(focus); opacity = 0.9; }
    else if (other) { fill = color(1 - focus); opacity = 0.45; }
    const poly = L.polygon(h.outline, { color: fill, weight: 1, fillColor: fill, fillOpacity: opacity });
    const tag = ov === 'star' ? ' ⭐' : ov === 'dark' ? ' 🌑' : '';
    const stops = routes.map((r, ri) => order[ri].get(i) && `Stop ${order[ri].get(i)} on ${r.label}`).filter(Boolean);
    poly.bindTooltip(`<b>${h.address || 'House'}${tag}</b>${stops.map((t) => `<br>${t}`).join('')}`, { sticky: true });
    poly.on('click', () => {
      const next = OVERRIDES[(OVERRIDES.indexOf(ov) + 1) % OVERRIDES.length];
      if (next === 'normal') delete overrides[h.id]; else overrides[h.id] = next;
      localStorage.setItem('cm:overrides', JSON.stringify(overrides));
      solveAndDraw(budgetMin).catch((e) => status(e.message, true));
    });
    poly.addTo(layers.houses);
  });

  // Routes: the other one dimmed and dashed underneath; the followed one on top with arrows.
  layers.route.clearLayers();
  layers.arrows.clearLayers();
  const drawOrder = routes.map((_, i) => i).sort((a, b) => (a === focus) - (b === focus));
  for (const i of drawOrder) {
    const on = i === focus;
    if (on) L.polyline(geo[i].pts, { color: '#000', weight: 8, opacity: 0.45, interactive: false }).addTo(layers.route);
    L.polyline(geo[i].pts, {
      color: color(i), weight: on ? 4 : 3, opacity: on ? 1 : 0.6, dashArray: on ? null : '6 6',
    }).on('click', () => setFocus(i)).addTo(layers.route);
  }
  if (fitNext) {
    fitNext = false;
    map.fitBounds(L.latLngBounds(geo.flatMap((x) => x.pts)), { padding: [30, 30], maxZoom: 17, animate: false });
  }
  arrowLayer(map, geo[focus].pts, color(focus)).addTo(layers.arrows);
  L.marker([start.lat, start.lon], {
    icon: L.divIcon({ className: 'home-icon', html: '🏠', iconSize: [28, 28], iconAnchor: [14, 14] }),
  }).bindTooltip(`Start & finish: ${start.label}`).addTo(layers.route);

  renderCompare(routes, budgetMin);
  renderProfile($('profile'), routes.map((r, i) => ({ label: r.label, color: color(i), focused: i === focus, pts: geo[i].prof })), {
    onHover: (hits) => {
      layers.cursor.clearLayers();
      for (const p of hits) L.circleMarker([p.lat, p.lon], { radius: 6, color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 1 }).addTo(layers.cursor);
    },
  });
  renderDirections(g, routes[focus], geo[focus]);
  $('results').hidden = false;
}

function setFocus(i) {
  if (i === focus || !shown || i >= shown.routes.length) return;
  focus = i;
  draw();
}

function renderCompare(routes, budgetMin) {
  const two = routes.length > 1;
  const rows = [
    ['Candy', (r) => `≈ ${Math.round(r.candy)}`, (r) => r.candy, true],
    ['Houses', (r) => r.stops.length, (r) => r.stops.length],
    ['Walking', (r) => `${(r.distM / M_PER_MI).toFixed(2)} mi`, (r) => r.distM],
    ['Climb', (r) => `${Math.round(r.climbM * FT_PER_M)} ft`, (r) => r.climbM],
    ['Time', (r) => `${Math.round(r.totalSec / 60)} min`, (r) => r.totalSec],
    ['Pieces / min', (r) => (r.candy / (r.totalSec / 60) || 0).toFixed(1), (r) => r.candy / r.totalSec],
  ];
  const delta = (a, b) => {
    if (!a) return '';
    const pct = Math.round(((b - a) / a) * 100);
    return pct ? `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` : 'same';
  };
  const head = routes.map((r, i) => `<th><button class="route-tab${i === focus ? ' active' : ''}" data-i="${i}" aria-pressed="${i === focus}">
      <i style="background:${ROUTE_COLORS[i]}"></i>${r.label}</button></th>`).join('');
  const body = rows.map(([label, fmt, val, hero]) => `<tr${hero ? ' class="hero"' : ''}><th>${label}</th>${routes.map((r, i) =>
    `<td>${fmt(r)}${two && i === 1 ? `<small>${delta(val(routes[0]), val(r))}</small>` : ''}</td>`).join('')}</tr>`).join('');
  const note = routes[0].note || (routes[1]?.key === 'more' ? `${routes[1].label} walks for up to ${budgetMin + 30} min.` : '');
  $('compare').innerHTML = `<table class="compare"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>
    ${note ? `<p class="note">${note}</p>` : ''}`;
  $('compare').querySelectorAll('.route-tab').forEach((b) => b.addEventListener('click', () => setFocus(+b.dataset.i)));
}

function renderDirections(g, route, geo) {
  const steps = buildSteps(g, area.net, route.legs);
  $('dirTitle').textContent = shown.routes.length > 1 ? `Directions: ${route.label}` : 'Directions';
  const list = $('directions');
  list.innerHTML = steps.map((s) => `<li>${stepText(s)} <small>${Math.round(s.m * FT_PER_M).toLocaleString()} ft${
    s.houses ? ` · ${s.houses} house${s.houses > 1 ? 's' : ''}` : ''}</small></li>`).join('') + '<li>Arrive home 🏠</li>';
  // Hover a step to light it up on the map. Steps split the walked edges in order,
  // so step i spans points [edges before it, edges before it + its own].
  let first = 0;
  [...list.children].forEach((li, i) => {
    const s = steps[i];
    const from = first, to = first + (s?.edges.length ?? 0);
    first = to;
    li.addEventListener('mouseenter', () => {
      layers.highlight.clearLayers();
      if (to > from) L.polyline(geo.pts.slice(from, to + 1), { color: '#fff', weight: 7, opacity: 0.9, interactive: false }).addTo(layers.highlight);
    });
    li.addEventListener('mouseleave', () => layers.highlight.clearLayers());
  });
}

if (readUrl()) run();
