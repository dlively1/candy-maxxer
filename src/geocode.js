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

export async function geocode(address) {
  for (const fn of [census, nominatim]) {
    try {
      const r = await fn(address);
      if (r) return r;
    } catch { /* try next */ }
  }
  throw new Error(`Couldn't find "${address}"`);
}
