// Shared setup: saved OSM data + real terrain tiles around Shiloh St on Mount Washington,
// Pittsburgh: a public business strip on a famously steep hill. No network needed.
import { readFileSync } from 'node:fs';
import { makeProjection } from '../src/geo.js';
import { parseOsm } from '../src/osm.js';
import { buildNetwork, buildCSR, attachHouses, levelStructures } from '../src/graph.js';
import { elevations } from '../src/elevation.js';
import { candyValue } from '../src/candy.js';
import { decodePng } from './png.js';

export const START = { lat: 40.429413, lon: -80.007257 }; // 301 Shiloh St (a shop)
const data = JSON.parse(readFileSync(new URL('./fixtures/mt-washington.json', import.meta.url)));
const fixtureTile = async (z, x, y) => decodePng(readFileSync(new URL(`./fixtures/tiles/${z}_${x}_${y}.png`, import.meta.url)));

// terrain: 'real' (fixture tiles) or a number = synthetic ramp rising that many meters per 100 m east.
export async function setup({ terrain = 'real', pace = 0.85, porchSec = 30, start = START } = {}) {
  const proj = makeProjection(start.lat, start.lon);
  const { ways, houses } = parseOsm(data, proj);
  const net = buildNetwork(ways, proj);
  let z, hz;
  if (terrain === 'real') {
    const all = await elevations([...net.lat.map((la, i) => [la, net.lon[i]]), ...houses.map((h) => [h.lat, h.lon])], fixtureTile);
    z = all.subarray(0, net.n); hz = all.subarray(net.n);
    levelStructures(net, z);
  } else {
    const zAt = (x) => (x / 100) * terrain;
    z = Float64Array.from(net.x, zAt); hz = houses.map((h) => zAt(h.x));
  }
  const g = buildCSR(net, z, pace);
  const hs = attachHouses(net, houses, hz, z, { pace, porchSec });
  hs.forEach((h) => { h.value = candyValue(h); });
  const startNode = net.grid.nearest(0, 0, 300, net.walkable).id;
  return { net, g, hs, startNode, houses, z };
}

export function legStats(g, net, legs) {
  let m = 0, climb = 0;
  for (const leg of legs) for (const k of leg) {
    m += Math.hypot(net.x[g.to[k]] - net.x[g.from[k]], net.y[g.to[k]] - net.y[g.from[k]]);
    climb += Math.max(0, g.rise[k]);
  }
  return { m, climb };
}
