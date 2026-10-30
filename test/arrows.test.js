import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetPath } from '../src/arrows.js';
import { buildSteps, turnaroundPoints } from '../src/directions.js';
import { setup } from './helpers.js';
import { plan } from '../src/plan.js';

const P = (x, y) => ({ x, y });
const near = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

test('offset lane sits to the right of travel', () => {
  // heading east on screen (y down): right is +y
  const out = offsetPath([P(0, 0), P(10, 0), P(20, 0)], 4);
  assert.deepEqual(out.map((q) => q.y), [4, 4, 4]);
});

test('offset keeps its distance around a corner', () => {
  // east then south (a right turn): the corner point moves inside by a miter of 4·√2
  const out = offsetPath([P(0, 0), P(10, 0), P(10, 10)], 4);
  assert.ok(near(out[1], P(6, 4)), JSON.stringify(out[1]));
});

test('a doubled-back path crosses over, drawing the U-turn', () => {
  const out = offsetPath([P(0, 0), P(10, 0), P(10, 0), P(0, 0)], 4); // duplicate points are skipped
  assert.equal(out.length, 4);
  assert.ok(near(out[1], P(10, 4)) && near(out[2], P(10, -4)), JSON.stringify(out));
  assert.equal(out[3].y, -4); // the way back runs on the other side
});

test('turnaround points index the route where it reverses', async () => {
  const s = await setup();
  const routes = plan({ g: s.g, houses: s.hs, startNode: s.startNode, budgetSec: 90 * 60, alt: 'fresh' });
  let seen = 0;
  for (const r of routes) {
    const steps = buildSteps(s.g, s.net, r.legs);
    const edges = r.legs.flat();
    const at = turnaroundPoints(steps);
    assert.equal(at.length, steps.filter((x) => x.action === 'turn around').length);
    for (const j of at) {
      // point j is where the turnaround step's first edge starts
      assert.ok(j > 0 && j < edges.length);
      assert.equal(s.g.from[edges[j]], s.g.to[edges[j - 1]]);
      seen++;
    }
  }
  assert.ok(seen > 0, 'expected a turnaround on Mount Washington');
});
