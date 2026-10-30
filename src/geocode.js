// US Census geocoder first (best house-number accuracy, JSONP so no CORS needed),
// then OpenStreetMap Nominatim as a fallback.

function jsonp(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const cb = `cm_cb_${Math.random().toString(36).slice(2)}`;
    const s = document.createElement('script');
    const done = (fn, v) => { delete window[cb]; s.remove(); clearTimeout(t); fn(v); };
    const t = setTimeout(() => done(reject, new Error('Geocoder timed out')), timeoutMs);
    window[cb] = (data) => done(resolve, data);
    s.onerror = () => done(reject, new Error('Geocoder failed'));
    s.src = `${url}&format=jsonp&callback=${cb}`;
    document.head.append(s);
  });
}

async function census(address) {
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
    + `?benchmark=Public_AR_Current&address=${encodeURIComponent(address)}`;
  const m = (await jsonp(url)).result.addressMatches[0];
  return m && { lat: m.coordinates.y, lon: m.coordinates.x, label: m.matchedAddress };
}

async function nominatim(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const r = (await (await fetch(url)).json())[0];
  return r && { lat: +r.lat, lon: +r.lon, label: r.display_name };
}

// Remember recent lookups so planning the same address again skips the round trip.
const MEMO = 'cm:geo', MEMO_KEEP = 50;
const memoKey = (address) => address.trim().toLowerCase().replace(/\s+/g, ' ');

function remembered(address) {
  try { return JSON.parse(localStorage.getItem(MEMO) || '{}')[memoKey(address)]; } catch { return undefined; }
}

function remember(address, hit) {
  try {
    const memo = JSON.parse(localStorage.getItem(MEMO) || '{}');
    delete memo[memoKey(address)];
    memo[memoKey(address)] = hit; // re-insert: newest last
    const keys = Object.keys(memo);
    for (const k of keys.slice(0, Math.max(0, keys.length - MEMO_KEEP))) delete memo[k];
    localStorage.setItem(MEMO, JSON.stringify(memo));
  } catch { /* no storage */ }
}

export async function geocode(address) {
  const known = remembered(address);
  if (known) return known;
  for (const fn of [census, nominatim]) {
    try {
      const r = await fn(address);
      if (r) { remember(address, r); return r; }
    } catch { /* try next */ }
  }
  throw new Error(`Couldn't find "${address}"`);
}
