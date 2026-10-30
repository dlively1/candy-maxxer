// The address box: type-ahead suggestions (Photon, OpenStreetMap-based, CORS-friendly) biased
// toward where you are, plus "use my location" via the browser's geolocation.

const PHOTON = 'https://photon.komoot.io';
const DEBOUNCE_MS = 220;

const ICONS = { house: '🏠', residential: '🏠', street: '🛣️', city: '🏙️', town: '🏘️', village: '🏘️', suburb: '🏘️' };

// "301 Shiloh Street, Pittsburgh, Pennsylvania" from a Photon feature.
export function featureLabel(p) {
  const line1 = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.name || p.street || '';
  const place = p.city || p.town || p.village || p.district || p.county;
  return [line1, place && place !== line1 ? place : null, p.state].filter(Boolean).join(', ');
}

export function addressBox({ input, list, getBias, onPick }) {
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

  const search = async (q) => {
    ctrl?.abort();
    ctrl = new AbortController();
    const bias = getBias();
    const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6&lang=en${bias ? `&lat=${bias.lat}&lon=${bias.lon}` : ''}`;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const { features } = await res.json();
      // If they typed a house number but OSM only knows the street, keep their number
      // and let the regular geocoder find the exact spot when they plan.
      const typedNum = q.match(/^\s*(\d+[a-z]?)\s/i)?.[1];
      items = features.map((f) => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const keepNum = typedNum && !p.housenumber && p.osm_key === 'highway';
        const label = keepNum ? `${typedNum} ${featureLabel(p)}` : featureLabel(p);
        const [main, ...rest] = label.split(', ');
        return { label, main, sub: rest.join(', '), icon: ICONS[p.osm_value] || ICONS[p.type] || '📍', ...(keepNum ? {} : { lat, lon }) };
      }).filter((it, i, a) => it.label && a.findIndex((x) => x.label === it.label) === i);
      if (document.activeElement === input) render();
    } catch (e) {
      if (e.name !== 'AbortError') { items = []; close(); }
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
  let label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`);
    const f = (await res.json()).features?.[0];
    if (f) label = featureLabel(f.properties);
  } catch { /* keep the coordinates as the label */ }
  return { lat, lon, label };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
