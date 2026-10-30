// Elevation from AWS Terrain Tiles (Terrarium PNG encoding): free, keyless, CORS-enabled.
// height = R*256 + G + B/256 - 32768

const Z = 15; // ~3.6 m/px at mid-US latitudes; source DEM is USGS 3DEP (~10 m)
const URL_T = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;

export function globalPixel(lat, lon, z = Z) {
  const n = 2 ** z * 256;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

// Browser tile loader: returns RGBA bytes (256×256×4).
async function loadTileRGBA(z, x, y) {
  const res = await fetch(URL_T(x, y));
  if (!res.ok) throw new Error(`Elevation tile ${x}/${y}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(256, 256);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, 256, 256).data;
}

export const TILE_ZOOM = Z;

// points: array of [lat, lon]. Returns a Float64Array of meters (bilinear-interpolated).
export async function elevations(points, loadRGBA = loadTileRGBA) {
  const loadTile = async (x, y) => {
    const px = await loadRGBA(Z, x, y);
    const h = new Float32Array(256 * 256);
    for (let i = 0; i < h.length; i++) h[i] = decodeTerrarium(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    return h;
  };
  // Pixel centers sit at +0.5, so sample the 4 pixels around (px - 0.5, py - 0.5).
  const gp = points.map(([la, lo]) => globalPixel(la, lo).map((v) => v - 0.5));
  const need = new Set();
  for (const [fx, fy] of gp) {
    for (const dx of [0, 1]) for (const dy of [0, 1]) {
      need.add(`${Math.floor((Math.floor(fx) + dx) / 256)},${Math.floor((Math.floor(fy) + dy) / 256)}`);
    }
  }
  const tiles = new Map();
  await Promise.all([...need].map(async (k) => {
    const [x, y] = k.split(',').map(Number);
    tiles.set(k, await loadTile(x, y));
  }));
  const at = (ix, iy) => {
    const t = tiles.get(`${Math.floor(ix / 256)},${Math.floor(iy / 256)}`);
    return t[(iy % 256) * 256 + (ix % 256)];
  };
  const out = new Float64Array(points.length);
  gp.forEach(([fx, fy], i) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    out[i] = at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty)
      + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
  });
  return out;
}
