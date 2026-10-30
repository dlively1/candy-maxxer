// The address box: type-ahead suggestions (houses already on the map first, then Photon,
// OpenStreetMap-based and CORS-friendly, kept near where you are), plus "use my location".

const PHOTON = 'https://photon.komoot.io';
const DEBOUNCE_MS = 220;

// Within this of the bias point (degrees of latitude, ~30 km) unless they typed a town after a comma.
const NEAR_DEG = 0.27;
// Transit stops match street names ("Main St at Penn Ave") but nobody starts there.
const SKIP_TAGS = '&osm_tag=!highway:bus_stop&osm_tag=!public_transport&osm_tag=!railway';

const ICONS = { house: '🏠', residential: '🏠', street: '🛣️', city: '🏙️', town: '🏘️', village: '🏘️', suburb: '🏘️' };

// "301 Shiloh Street, Pittsburgh, Pennsylvania" from a Photon feature.
export function featureLabel(p) {
  const line1 = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.name || p.street || '';
  const place = p.city || p.town || p.village || p.district || p.county;
  return [line1, place && place !== line1 ? place : null, p.state].filter(Boolean).join(', ');
}

// "Pittsburgh, Pennsylvania" from a Photon feature.
export const placeLabel = (p) => [p.city || p.town || p.village || p.district || p.county, p.state].filter(Boolean).join(', ');

// Photon's properties for the nearest named thing to (lat, lon), or null.
export async function reverse(lat, lon) {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`);
    return (await res.json()).features?.[0]?.properties ?? null;
  } catch { return null; }
}

// getBias() → { lat, lon, strict } or null. strict: only suggest places nearby.
// local(q) → suggestions from data already loaded (shown first, instantly).

export function addressBox({ input, list, getBias, local = () => [], onPick }) {
  let timer = 0, ctrl = null, items = [], active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', list.children[i].id);
  };
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    input.value = it.label;
    close();
    onPick(it);
  };

  const render = () => {
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((it, i) => `<li id="addr-opt-${i}" role="option" aria-selected="false">
      <span class="ac-icon" aria-hidden="true">${it.icon}</span>
      <span class="ac-text"><b>${esc(it.main)}</b><small>${esc(it.sub)}</small></span></li>`).join('');
    [...list.children].forEach((li, i) => {
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); }); // before the input blurs
      li.addEventListener('mousemove', () => active !== i && highlight(i));
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  };

  const photon = async (q, bias, near, signal) => {
    let url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6&lang=en${SKIP_TAGS}`;
    if (bias) url += `&lat=${bias.lat}&lon=${bias.lon}&location_bias_scale=0.1&zoom=13`;
    if (near) {
      const dLon = NEAR_DEG / Math.cos((bias.lat * Math.PI) / 180);
      url += `&bbox=${[bias.lon - dLon, bias.lat - NEAR_DEG, bias.lon + dLon, bias.lat + NEAR_DEG].map((v) => v.toFixed(4))}`;
    }
    const res = await fetch(url, { signal });
    return (await res.json()).features;
  };

  const search = async (q) => {
    ctrl?.abort();
    ctrl = new AbortController();
    const bias = getBias();
    const mine = local(q);
    items = mine;
    if (mine.length && document.activeElement === input) render();
    try {
      // Nearby only, unless they named a town ("…, Columbus") or nothing nearby matches.
      const near = bias?.strict && !q.includes(',');
      let features = await photon(q, bias, near, ctrl.signal);
      if (near && !features.length) features = await photon(q, bias, false, ctrl.signal);
      // If they typed a house number but OSM only knows the street, keep their number
      // and let the regular geocoder find the exact spot when they plan.
      const typedNum = q.match(/^\s*(\d+[a-z]?)\s/i)?.[1];
      const found = features.map((f) => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const keepNum = typedNum && !p.housenumber && p.osm_key === 'highway';
        const label = keepNum ? `${typedNum} ${featureLabel(p)}` : featureLabel(p);
        const [main, ...rest] = label.split(', ');
        return { label, main, sub: rest.join(', '), icon: ICONS[p.osm_value] || ICONS[p.type] || '📍', ...(keepNum ? {} : { lat, lon }) };
      });
      const seen = (it) => mine.some((m) => m.main.toLowerCase() === it.main.toLowerCase());
      items = [...mine, ...found.filter((it) => !seen(it))]
        .filter((it, i, a) => it.label && a.findIndex((x) => x.label === it.label) === i).slice(0, 7);
      if (document.activeElement === input) render();
    } catch (e) {
      if (e.name !== 'AbortError' && !mine.length) { items = []; close(); }
    }
  };

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { items = []; close(); return; }
    timer = setTimeout(() => search(q), DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  return { close };
}

// Ask the browser where we are, then name the spot. Resolves { lat, lon, label } or throws.
export async function locate() {
  if (!navigator.geolocation) throw new Error('This browser can’t share its location.');
  const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true, timeout: 12000, maximumAge: 5 * 60 * 1000,
  }));
  const { latitude: lat, longitude: lon } = pos.coords;
  const p = await reverse(lat, lon);
  return { lat, lon, label: p ? featureLabel(p) : `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
