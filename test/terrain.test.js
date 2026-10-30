import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { plan } from '../src/plan.js';

const s = await setup();

test('roads closed to walkers (the bus-only Transit Tunnel) are left out', () => {
  assert.ok(!s.net.names.includes('Mount Washington Transit Tunnel'));
});

test('bridges and tunnels ramp smoothly instead of following the ground under/over them', () => {
  assert.ok(s.net.levels.length > 0, 'fixture should contain bridges/tunnels');
  for (const chain of s.net.levels) {
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1], b = chain[i];
      const run = Math.hypot(s.net.x[b] - s.net.x[a], s.net.y[b] - s.net.y[a]);
      if (run > 1) assert.ok(Math.abs(s.z[b] - s.z[a]) / run < 0.25, `slope ${(s.z[b] - s.z[a]) / run} on a bridge/tunnel`);
    }
  }
});

test('starting next to a highway tunnel still plans a full neighborhood route', async () => {
  // A phone's GPS fix on the hillside by P J McArdle Roadway (where this used to strand routes).
  const near = await setup({ start: { lat: 40.4306, lon: -80.0047 } });
  const [a] = plan({ g: near.g, houses: near.hs, startNode: near.startNode, budgetSec: 90 * 60, alt: 'none' });
  assert.ok(a.stops.length > 40, `only ${a.stops.length} houses`);
});
