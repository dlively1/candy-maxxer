import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, routeLegs } from '../src/solver.js';
import { setup } from './helpers.js';

const flat = await setup({ terrain: 0 });
const real = await setup();

test('fixture parses into houses and a walkable network', () => {
  assert.ok(real.houses.length > 600, `houses: ${real.houses.length}`);
  assert.ok(real.hs.length > 600);
  assert.ok(real.net.n > 1000);
});

test('every house and the start sit on one connected network', () => {
  const { net, hs, startNode } = real;
  assert.ok(net.walkable(startNode));
  assert.ok(hs.every((h) => net.walkable(h.node)));
});

test('real terrain is hilly (Mount Washington)', () => {
  const zs = [...real.z];
  assert.ok(Math.max(...zs) - Math.min(...zs) > 50, 'expected > 50 m of relief');
});

test('route fits the budget, returns home, never repeats a house', () => {
  const { g, hs, startNode } = real;
  const budgetSec = 60 * 60;
  const r = solve({ g, houses: hs, startNode, budgetSec });
  assert.ok(r.totalSec <= budgetSec + 1e-6);
  assert.ok(r.stops.length > 30, `stops: ${r.stops.length}`);
  assert.equal(new Set(r.stops.map((h) => h.index)).size, r.stops.length);
  const legs = routeLegs(g, startNode, r.stops);
  assert.equal(legs.length, r.stops.length + 1);
  // Consecutive edges connect, and the walk ends at home.
  const edges = legs.flat();
  for (let i = 1; i < edges.length; i++) assert.equal(g.from[edges[i]], g.to[edges[i - 1]]);
  assert.equal(g.to[edges.at(-1)], startNode);
});

test('more time never means less candy', () => {
  const { g, hs, startNode } = real;
  const a = solve({ g, houses: hs, startNode, budgetSec: 30 * 60 });
  const b = solve({ g, houses: hs, startNode, budgetSec: 90 * 60 });
  assert.ok(b.candy >= a.candy);
});

test('steeper ground means less candy in the same time', async () => {
  const steep = await setup({ terrain: 15 });
  const rf = solve({ g: flat.g, houses: flat.hs, startNode: flat.startNode, budgetSec: 45 * 60 });
  const rs = solve({ g: steep.g, houses: steep.hs, startNode: steep.startNode, budgetSec: 45 * 60 });
  assert.ok(rs.candy < rf.candy, `steep ${rs.candy} vs flat ${rf.candy}`);
});

test('dark houses are skipped', () => {
  const { g, startNode } = real;
  const hs = real.hs.map((h) => ({ ...h }));
  const r1 = solve({ g, houses: hs, startNode, budgetSec: 30 * 60 });
  const darkened = new Set(r1.stops.slice(0, 5).map((h) => h.index));
  for (const h of hs) if (darkened.has(h.index)) h.value = 0;
  const r2 = solve({ g, houses: hs, startNode, budgetSec: 30 * 60 });
  assert.ok(r2.stops.every((h) => !darkened.has(h.index)));
});

test('hill-averse solving climbs less than ignoring hills', () => {
  const { g, hs, startNode } = real;
  const base = solve({ g, houses: hs, startNode, budgetSec: 60 * 60, climb: { secPerMeter: 20, candyPerMeter: 0 } });
  const averse = solve({ g, houses: hs, startNode, budgetSec: 60 * 60, climb: { secPerMeter: 20, candyPerMeter: 1 } });
  assert.ok(averse.climbM < base.climbM, `averse ${averse.climbM} vs ${base.climbM}`);
  assert.ok(averse.totalSec <= 60 * 60 + 1e-6);
});
