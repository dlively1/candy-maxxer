// Fetch and parse OpenStreetMap data: walkable ways + candidate houses.

import { polygonAreaCentroid } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export function overpassQuery(lat, lon, radius) {
  const a = `(around:${Math.round(radius)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return `[out:json][timeout:90];(way["highway"]${a};way["building"]${a};node["addr:housenumber"]${a};);out geom;`;
}

export async function fetchOsm(lat, lon, radius, onStatus = () => {}) {
  const key = `cm:osm:${lat.toFixed(4)},${lon.toFixed(4)},${Math.round(radius)}`;
  const cached = localStorage.getItem(key);
  if (cached) return JSON.parse(cached);

  // Public Overpass servers are often overloaded: ask them all, keep the first good answer,
  // and back off and retry if every one of them is busy.
  const body = 'data=' + encodeURIComponent(overpassQuery(lat, lon, radius));
  let text;
  for (let attempt = 0; !text; attempt++) {
    onStatus(attempt ? `Map servers busy, retry ${attempt}…` : 'Fetching houses & streets from OpenStreetMap…');
    try {
      text = await raceEndpoints(body);
    } catch {
      if (attempt >= 4) throw new Error('OpenStreetMap servers are busy right now. Try again in a few minutes.');
      const wait = 5 * 2 ** attempt;
      for (let s = wait; s > 0; s--) {
        onStatus(`Map servers busy, retrying in ${s}s…`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
  try {
    clearOldCache();
    localStorage.setItem(key, text);
  } catch { /* quota exceeded: skip caching */ }
  return JSON.parse(text);
}

async function raceEndpoints(body) {
  const ctrls = ENDPOINTS.map(() => new AbortController());
  try {
    return await Promise.any(ENDPOINTS.map(async (url, i) => {
      const res = await fetch(url, {
        method: 'POST', body, signal: AbortSignal.any([ctrls[i].signal, AbortSignal.timeout(90000)]),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
      const t = await res.text();
      JSON.parse(t);
      return t;
    }));
  } finally {
    ctrls.forEach((c) => c.abort());
  }
}

function clearOldCache() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('cm:osm:')) localStorage.removeItem(k);
}

// --- Parsing (pure; runs in Node tests too) ---

const NOT_WALKABLE = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed',
  'raceway', 'bus_guideway', 'track', 'bridleway', 'cycleway', 'corridor', 'elevator', 'platform',
]);

export function isWalkable(tags) {
  const hw = tags.highway;
  if (!hw || NOT_WALKABLE.has(hw)) return false;
  if (tags.area === 'yes') return false;
  if (tags.foot === 'no' || (tags.access === 'private' && tags.foot !== 'yes')) return false;
  if (hw === 'service' && tags.service === 'parking_aisle') return false;
  return true;
}

const HOUSE_TYPES = new Set(['house', 'detached', 'residential', 'semidetached_house', 'bungalow', 'terrace', 'farm', 'yes']);

export function wayName(tags) {
  if (tags.name) return tags.name;
  if (tags.ref) return tags.ref;
  if (['footway', 'path', 'pedestrian', 'steps'].includes(tags.highway)) return tags.highway === 'steps' ? 'steps' : 'footpath';
  if (tags.service === 'driveway') return 'driveway';
  return 'unnamed road';
}

// Returns { ways: [{ nodes: [id...], coords: [[lat,lon]...], name, highway }], houses: [...] }
export function parseOsm(data, proj) {
  const ways = [];
  const houses = [];
  const addrNodes = [];
  for (const el of data.elements) {
    const tags = el.tags || {};
    if (el.type === 'node' && tags['addr:housenumber']) {
      addrNodes.push(el);
    } else if (el.type === 'way' && tags.highway && isWalkable(tags) && el.geometry) {
      ways.push({
        nodes: el.nodes,
        coords: el.geometry.map((g) => [g.lat, g.lon]),
        name: wayName(tags),
        highway: tags.highway,
      });
    } else if (el.type === 'way' && tags.building && el.geometry) {
      const h = parseHouse(el, proj);
      if (h) houses.push(h);
    }
  }
  // Attach stray address points (not on a building) to the nearest unaddressed house.
  for (const n of addrNodes) {
    const [x, y] = proj.toXY(n.lat, n.lon);
    let best = null, bd = 30;
    for (const h of houses) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd && !h.address) { bd = d; best = h; }
    }
    if (best) best.address = formatAddress(n.tags);
  }
  return { ways, houses };
}

function parseHouse(el, proj) {
  const t = el.tags;
  if (!HOUSE_TYPES.has(t.building)) return null;
  if (t.shop || t.amenity || t.office || t.craft || t.tourism || t.leisure) return null;
  const pts = el.geometry.map((g) => proj.toXY(g.lat, g.lon));
  const { area, x, y } = polygonAreaCentroid(pts);
  // Untagged "yes" buildings are often sheds or garages: demand a house-like footprint.
  const [minA, maxA] = t.building === 'yes' ? [70, 600] : [45, 900];
  if (area < minA || area > maxA) return null;
  const [lat, lon] = proj.toLatLon(x, y);
  return {
    id: el.id,
    lat, lon, x, y, area,
    address: formatAddress(t),
    outline: el.geometry.map((g) => [g.lat, g.lon]),
  };
}

function formatAddress(t) {
  const num = t['addr:housenumber'];
  const st = t['addr:street'];
  if (!num) return null;
  return st ? `${num} ${st}` : num;
}
