// Local flat-earth projection: fine at neighborhood scale (< a few km).

const R = 6371008.8;

export function makeProjection(lat0, lon0) {
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
  const ky = (Math.PI / 180) * R;
  return {
    toXY: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLatLon: (x, y) => [lat0 + y / ky, lon0 + x / kx],
  };
}

// Shoelace area (m²) and centroid of a closed ring of [x, y] points.
export function polygonAreaCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [x0, y0] = pts[j], [x1, y1] = pts[i];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = pts.length;
    return { area: 0, x: pts.reduce((s, p) => s + p[0], 0) / n, y: pts.reduce((s, p) => s + p[1], 0) / n };
  }
  return { area: Math.abs(a / 2), x: cx / (3 * a), y: cy / (3 * a) };
}

// Uniform-grid spatial index over points, for nearest-neighbor lookups.
export class Grid {
  constructor(cell = 50) { this.cell = cell; this.map = new Map(); }
  key(ix, iy) { return ix * 100003 + iy; }
  add(id, x, y) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = []));
    b.push(id, x, y);
  }
  nearest(x, y, maxDist = 200, accept = null) {
    const ix = Math.floor(x / this.cell), iy = Math.floor(y / this.cell);
    const r = Math.ceil(maxDist / this.cell);
    let best = -1, bd = maxDist * maxDist;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const b = this.map.get(this.key(ix + dx, iy + dy));
      if (!b) continue;
      for (let i = 0; i < b.length; i += 3) {
        const d = (b[i + 1] - x) ** 2 + (b[i + 2] - y) ** 2;
        if (d < bd && (!accept || accept(b[i]))) { bd = d; best = b[i]; }
      }
    }
    return best < 0 ? null : { id: best, dist: Math.sqrt(bd) };
  }
}
