// Direction cues along a route, all kept to the right of travel so an out-and-back street shows
// "down this side, back that side": chevrons evenly spaced on screen, and a slow lane of glowing
// dots drifting the way you walk. Both are re-laid out on zoom.

const SPACING_PX = 70;
const OFFSET_PX = 11;

// `avoid`: spots (e.g. U-turn badges) that arrows keep clear of.
export function arrowLayer(map, latlngs, color, { pop = false, avoid = [] } = {}) {
  const group = L.layerGroup();
  let n = 0;
  const icon = (deg) => L.divIcon({
    className: 'route-arrow',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<span class="${pop ? 'pop' : ''}" style="animation-delay:${Math.min(n++ * 30, 900)}ms"><svg viewBox="0 0 20 20" style="transform:rotate(${deg}deg)"><path d="M4 3 L17 10 L4 17 L7.5 10 Z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></span>`,
  });

  const layout = () => {
    group.clearLayers();
    n = 0;
    const pts = latlngs.map((ll) => map.latLngToLayerPoint(ll));
    const keepOut = avoid.map((ll) => map.latLngToLayerPoint(ll));
    let until = SPACING_PX / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (!len) continue;
      const ux = dx / len, uy = dy / len;
      while (until <= len) {
        // screen y points down, so (-uy, ux) is the right-hand side of travel
        const p = L.point(a.x + ux * until - uy * OFFSET_PX, a.y + uy * until + ux * OFFSET_PX);
        if (!keepOut.some((q) => q.distanceTo(p) < 20)) L.marker(map.layerPointToLatLng(p), { icon: icon((Math.atan2(uy, ux) * 180) / Math.PI), interactive: false, keyboard: false })
          .addTo(group);
        until += SPACING_PX;
      }
      until -= len;
    }
  };

  group.on('add', () => { map.on('zoomend', layout); layout(); pop = false; /* only pop in the first time */ });
  group.on('remove', () => map.off('zoomend', layout));
  return group;
}

// Shift a screen-space path `px` to the right of travel. Corners get a (capped) miter; where the
// path doubles back, it crosses from one side to the other, which draws the U-turn.
export function offsetPath(pts, px) {
  const p = pts.filter((q, i) => i === 0 || q.x !== pts[i - 1].x || q.y !== pts[i - 1].y);
  if (p.length < 2) return p.slice();
  const dirs = [];
  for (let i = 1; i < p.length; i++) {
    const dx = p[i].x - p[i - 1].x, dy = p[i].y - p[i - 1].y, len = Math.hypot(dx, dy);
    dirs.push({ x: dx / len, y: dy / len });
  }
  const right = (u) => ({ x: -u.y, y: u.x }); // screen y points down
  const at = (q, n, k = 1) => ({ x: q.x + n.x * px * k, y: q.y + n.y * px * k });
  const out = [at(p[0], right(dirs[0]))];
  for (let i = 1; i < p.length - 1; i++) {
    const a = right(dirs[i - 1]), b = right(dirs[i]);
    if (dirs[i - 1].x * dirs[i].x + dirs[i - 1].y * dirs[i].y < -0.5) { out.push(at(p[i], a), at(p[i], b)); continue; }
    const mx = a.x + b.x, my = a.y + b.y, ml = Math.hypot(mx, my);
    const n = { x: mx / ml, y: my / ml };
    out.push(at(p[i], n, 1 / Math.max(0.6, n.x * a.x + n.y * a.y)));
  }
  out.push(at(p.at(-1), right(dirs.at(-1))));
  return out;
}

let svg = null; // the map draws on canvas; this lane needs SVG for its CSS animation
const FLOW_OFFSET_PX = 4;

export function flowLayer(map, latlngs) {
  svg ??= L.svg({ padding: 0.5 });
  const line = L.polyline([], { renderer: svg, className: 'route-flow', interactive: false, color: '#fff3d6', weight: 3, opacity: 0.85, lineCap: 'round' });
  const layout = () => {
    const pts = offsetPath(latlngs.map((ll) => map.latLngToLayerPoint(ll)), FLOW_OFFSET_PX);
    line.setLatLngs(pts.map((q) => map.layerPointToLatLng(L.point(q.x, q.y))));
  };
  line.on('add', () => { map.on('zoomend', layout); layout(); });
  line.on('remove', () => map.off('zoomend', layout));
  return line;
}
