import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProjection } from '../src/geo.js';
import { buildNetwork } from '../src/graph.js';

// Synthetic streets laid out in meters around the start (0, 0).
const proj = makeProjection(40, -80);
let osmId = 1;
const way = (name, pts) => ({ name, highway: 'residential', nodes: pts.map(() => osmId++), coords: pts.map(([x, y]) => proj.toLatLon(x, y)) });
// A grid of streets: (cols + 1) north-south and (rows + 1) east-west lines, 100 m apart, from (x0, y0).
function grid(prefix, x0, y0, cols, rows) {
  const ids = new Map(), id = (x, y) => { const k = `${x},${y}`; if (!ids.has(k)) ids.set(k, osmId++); return ids.get(k); };
  const line = (name, pts) => ({ name, highway: 'residential', nodes: pts.map(([x, y]) => id(x, y)), coords: pts.map(([x, y]) => proj.toLatLon(x, y)) });
  const out = [];
  for (let c = 0; c <= cols; c++) out.push(line(`${prefix} ${c} St`, Array.from({ length: rows + 1 }, (_, r) => [x0 + c * 100, y0 + r * 100])));
  for (let r = 0; r <= rows; r++) out.push(line(`${prefix} ${r} Ave`, Array.from({ length: cols + 1 }, (_, c) => [x0 + c * 100, y0 + r * 100])));
  return out;
}

test('a start stays on its own neighborhood even when a bigger network is in the download', () => {
  // Home: a small subdivision around the start. Far off (but inside the download): a bigger town grid.
  const ways = [...grid('Home', -100, -100, 2, 2), ...grid('Town', 700, 700, 4, 4)];
  const net = buildNetwork(ways, proj);
  // The old rule (largest network only) has nothing within 400 m.
  assert.equal(net.grid.nearest(0, 0, 400, net.walkable), null);
  const snap = net.anchor(0, 0, 400);
  assert.ok(snap && snap.dist < 1, 'snaps onto the home grid');
  assert.ok(net.walkable(snap.id));
  // Only the home network is walkable now.
  const town = net.grid.nearest(1000, 1000, 50);
  assert.equal(net.walkable(town.id), false);
});

test('a stray stub right by the start does not strand the route', () => {
  // A 20 m private-drive fragment 5 m from the start; the real street 30 m away.
  const ways = [way('stub', [[5, 0], [5, 20]]), ...grid('Main', -230, -30, 3, 1)];
  const net = buildNetwork(ways, proj);
  const snap = net.anchor(5, 2, 400);
  assert.ok(snap.dist > 20, `skipped the stub (snapped ${snap.dist.toFixed(1)} m away)`);
  assert.ok(net.nodeNames[snap.id].size && [...net.nodeNames[snap.id]].some((i) => net.names[i].startsWith('Main')));
});

test('nothing walkable in reach: null', () => {
  const net = buildNetwork(grid('Far', 2000, 2000, 1, 1), proj);
  assert.equal(net.anchor(0, 0, 400), null);
});
