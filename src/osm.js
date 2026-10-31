// Fetch and parse OpenStreetMap data: walkable ways + candidate houses.

import { polygonAreaCentroid } from './geo.js';
import { cacheGet, cacheKeys, cacheSet } from './cache.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export function overpassQuery(lat, lon, radius) {
  const a = `(around:${Math.round(radius)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  // Busy servers turn away queries by their declared limits first, so keep them modest: even
  // the widest download is a few MB and takes seconds.
  return `[out:json][timeout:25][maxsize:67108864];(way["highway"]${a};way["building"]${a};node["addr:housenumber"]${a};);out geom;`;
}

// Download sizes we try, smallest first: a 600 m circle covers most routes in a dense
// neighborhood; sparse suburbs step up to a wider one.
export const RADII = [600, 1000, 1500];
// Areas are fetched around the center of a ~200 m grid cell (plus a margin covering the
// whole cell), so GPS jitter and next-door addresses reuse the same cached download.
const CELL_M = 200, CELL_MARGIN_M = 150;
const M_PER_DEG = 111320;

export function cellCenter(lat, lon) {
  const dLat = CELL_M / M_PER_DEG;
  const clat = Math.round(lat / dLat) * dLat;
  const dLon = CELL_M / (M_PER_DEG * Math.cos((clat * Math.PI) / 180));
  return [+clat.toFixed(6), +(Math.round(lon / dLon) * dLon).toFixed(6)];
}

// Only the fields and tags parseOsm reads (about a quarter smaller than the raw download).
const KEEP_TAGS = new Set(['highway', 'service', 'name', 'ref', 'foot', 'access', 'area', 'bridge', 'tunnel',
  'building', 'shop', 'amenity', 'office', 'craft', 'tourism', 'leisure', 'addr:housenumber', 'addr:street', 'building:flats']);
const round7 = (v) => Math.round(v * 1e7) / 1e7;

export function compactOsm(data) {
  const elements = [];
  for (const e of data.elements) {
    const tags = {};
    for (const k in e.tags) if (KEEP_TAGS.has(k)) tags[k] = e.tags[k];
    if (e.type === 'node') elements.push({ type: 'node', id: e.id, lat: round7(e.lat), lon: round7(e.lon), tags });
    else if (e.geometry) {
      elements.push({ type: 'way', id: e.id, nodes: e.nodes, tags,
        geometry: e.geometry.map((g) => ({ lat: round7(g.lat), lon: round7(g.lon) })) });
    }
  }
  return { elements };
}

const cacheKey = (clat, clon, r) => `osm:${clat},${clon}:${r}`;

// Saved downloads with how far they reach from (lat, lon) in every direction, farthest first.
export function savedAreas(keys, lat, lon) {
  const out = [];
  for (const key of keys) {
    const m = /^osm:(-?[\d.]+),(-?[\d.]+):(\d+)$/.exec(key);
    if (!m) continue;
    const dy = (m[1] - lat) * M_PER_DEG, dx = (m[2] - lon) * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
    out.push({ key, reach: +m[3] + CELL_MARGIN_M - Math.hypot(dx, dy) });
  }
  return out.sort((a, b) => b.reach - a.reach);
}

// Too little reach to plan a worthwhile route from.
const MIN_FALLBACK_REACH = 400;

// Houses & streets around (lat, lon) covering at least `radius` m: from the cache if any saved
// download (this cell's, or a neighbor's) is big enough, otherwise from Overpass (then saved).
// If Overpass is too busy, settles for the nearest saved download that still reaches a fair way.
// Returns { data, radius, cached, fallback }.
export async function loadOsm(lat, lon, radius, onStatus = () => {}) {
  const [clat, clon] = cellCenter(lat, lon);
  for (const r of RADII.filter((x) => x >= radius)) {
    const data = await cacheGet(cacheKey(clat, clon, r));
    if (data) return { data, radius: r, cached: true };
  }
  const saved = savedAreas(cacheKeys(), lat, lon);
  for (const { key } of saved.filter((s) => s.reach >= radius)) {
    const data = await cacheGet(key);
    if (data) return { data, radius, cached: true };
  }
  let fetched;
  try {
    fetched = await fetchOverpass(clat, clon, radius + CELL_MARGIN_M, onStatus);
  } catch (e) {
    for (const { key, reach } of saved.filter((s) => s.reach >= MIN_FALLBACK_REACH)) {
      const data = await cacheGet(key);
      if (data) return { data, radius: reach, cached: true, fallback: true };
    }
    throw e;
  }
  const data = compactOsm(fetched);
  cacheSet(cacheKey(clat, clon, radius), data);
  return { data, radius, cached: false };
}

async function fetchOverpass(lat, lon, radius, onStatus) {
  // Public Overpass servers are often overloaded: ask them all, keep the first good answer,
  // and back off and retry if every one of them is busy.
  const body = 'data=' + encodeURIComponent(overpassQuery(lat, lon, radius));
  for (let attempt = 0; ; attempt++) {
    onStatus(attempt ? `Map servers busy, retry ${attempt}…` : 'Fetching houses & streets from OpenStreetMap…');
    try {
      return JSON.parse(await raceEndpoints(body));
    } catch {
      if (attempt >= 4) throw new Error('OpenStreetMap servers are busy right now. Try again in a few minutes.');
      for (let s = 5 * 2 ** attempt; s > 0; s--) {
        onStatus(`Map servers busy, retrying in ${s}s…`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
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

// The old cache kept one raw download in localStorage (up to ~5 MB); free that space.
try {
  for (const k of Object.keys(localStorage)) if (k.startsWith('cm:osm:')) localStorage.removeItem(k);
} catch { /* no storage */ }

// --- Parsing (pure; runs in Node tests too) ---

const NOT_WALKABLE = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed',
  'raceway', 'bus_guideway', 'busway', 'track', 'bridleway', 'cycleway', 'corridor', 'elevator', 'platform',
]);
const FOOT_OK = new Set(['yes', 'designated', 'permissive']);

export function isWalkable(tags) {
  const hw = tags.highway, footOk = FOOT_OK.has(tags.foot);
  if (!hw || (NOT_WALKABLE.has(hw) && !footOk)) return false; // e.g. a trail tagged cycleway + foot=designated
  if (tags.area === 'yes') return false;
  if (tags.foot === 'no' || (['no', 'private'].includes(tags.access) && !footOk)) return false;
  if (hw === 'service' && tags.service === 'parking_aisle') return false;
  return true;
}

const HOUSE_TYPES = new Set(['house', 'detached', 'residential', 'semidetached_house', 'bungalow', 'terrace', 'farm', 'yes',
  'apartments', 'duplex', 'triplex']);
// Footprint limits (m²) by building type; anything else uses the house range.
const SIZE = { yes: [70, 600], terrace: [90, 4000], apartments: [90, 6000], duplex: [60, 1200], triplex: [80, 1500] };
const HOUSE_SIZE = [45, 900];
const ROW_HOUSE_M2 = 65; // a typical row house's footprint, to guess the doors in an unaddressed terrace
const MAX_UNITS = 12;

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
        // Terrain data is the ground surface: wrong for a bridge deck or a tunnel floor.
        level: (tags.bridge && tags.bridge !== 'no') || (tags.tunnel && tags.tunnel !== 'no'),
      });
    } else if (el.type === 'way' && tags.building && el.geometry) {
      const h = parseHouse(el, proj);
      if (h) houses.push(h);
    }
  }
  // Address points inside a building are its doors (a duplex mapped as one outline with an address
  // point per half); stray ones (not on a building) go to the nearest unaddressed house.
  for (const n of addrNodes) {
    const [x, y] = proj.toXY(n.lat, n.lon);
    const inside = houses.find((h) => inPolygon(x, y, h.pts));
    if (inside) {
      for (const num of houseNumbers(n.tags['addr:housenumber'])) inside.numbers.add(num);
      if (!inside.address) { inside.address = formatAddress(n.tags); inside.street = n.tags['addr:street']; }
      continue;
    }
    let best = null, bd = 30;
    for (const h of houses) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd && !h.address) { bd = d; best = h; }
    }
    if (best) { best.address = formatAddress(n.tags); best.street = n.tags['addr:street']; }
  }
  for (const h of houses) {
    h.units = doors(h);
    delete h.pts; delete h.numbers; delete h.kind; delete h.flats;
  }
  return { ways, houses };
}

// How many front doors a building has. Apartments count as one (a shared entrance); otherwise
// separate house numbers, then a mapped flat count, then (for a whole row of terraced houses) a
// guess from the footprint.
function doors(h) {
  if (h.kind === 'apartments') return 1;
  let n = h.numbers.size;
  if (n < 2 && h.flats > 1) n = h.flats;
  if (n < 2) n = { duplex: 2, triplex: 3 }[h.kind] || (h.kind === 'terrace' ? Math.round(h.area / ROW_HOUSE_M2) : 1);
  return Math.max(1, Math.min(MAX_UNITS, n));
}

// "12", "12;14", "12, 14", "12-16" (a range on one side of the street: 12, 14, 16). Letters and
// fractions ("12A", "12 1/2") are a single number.
export function houseNumbers(v) {
  if (!v) return [];
  const parts = String(v).split(/\s*[;,]\s*/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    const a = m && +m[1], b = m && +m[2];
    if (m && b > a && b - a <= 2 * MAX_UNITS) {
      const step = (b - a) % 2 === 0 ? 2 : 1;
      for (let k = a; k <= b && out.length < MAX_UNITS; k += step) out.push(String(k));
    } else out.push(p);
  }
  return out;
}

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function parseHouse(el, proj) {
  const t = el.tags;
  if (!HOUSE_TYPES.has(t.building)) return null;
  if (t.shop || t.amenity || t.office || t.craft || t.tourism || t.leisure) return null;
  const pts = el.geometry.map((g) => proj.toXY(g.lat, g.lon));
  const { area, x, y } = polygonAreaCentroid(pts);
  // Untagged "yes" buildings are often sheds or garages: demand a house-like footprint.
  // Rows of terraced houses and apartment blocks are bigger.
  const [minA, maxA] = SIZE[t.building] || HOUSE_SIZE;
  if (area < minA || area > maxA) return null;
  const [lat, lon] = proj.toLatLon(x, y);
  return {
    id: el.id,
    lat, lon, x, y, area,
    address: formatAddress(t), street: t['addr:street'],
    outline: el.geometry.map((g) => [g.lat, g.lon]),
    // Working fields for doors(), dropped once it has run.
    pts, kind: t.building, flats: parseInt(t['building:flats'], 10) || 0, numbers: new Set(houseNumbers(t['addr:housenumber'])),
  };
}

function formatAddress(t) {
  const num = t['addr:housenumber']?.replace(/\s*[;,]\s*/g, ', ');
  const st = t['addr:street'];
  if (!num) return null;
  return st ? `${num} ${st}` : num;
}
