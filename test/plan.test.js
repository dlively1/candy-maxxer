import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/plan.js';
import { setup } from './helpers.js';

const s = await setup();
const run = (alt, min = 90) => plan({ g: s.g, houses: s.hs, startNode: s.startNode, budgetSec: min * 60, alt });
const ids = (r) => new Set(r.stops.map((h) => h.index));

test('"none" plans a single Max Candy route', () => {
  const routes = run('none');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].key, 'max');
});

test('Easier legs is either clearly flatter or dropped with a note', () => {
  for (const min of [60, 150]) {
    const [a, b] = run('easy', min);
    if (b) {
      assert.equal(b.key, 'easy');
      assert.ok(b.climbM <= a.climbM - 3, `${min}m: easy ${b.climbM} vs max ${a.climbM}`);
      assert.ok(b.totalSec <= min * 60 + 1e-6);
    } else {
      assert.match(a.note, /No flatter route/);
    }
  }
});

test('Max Candy is never beaten by a same-budget alternative', () => {
  for (const alt of ['easy', 'fresh']) {
    const [a, b = a] = run(alt);
    assert.ok(a.candy >= b.candy - 0.5, `${alt}: max ${a.candy} < alt ${b.candy}`);
  }
});

test('Different streets mostly avoids the Max Candy houses', () => {
  const [a, b] = run('fresh');
  const seen = ids(a);
  const overlap = b.stops.filter((h) => seen.has(h.index)).length;
  assert.ok(overlap < b.stops.length * 0.25, `overlap ${overlap}/${b.stops.length}`);
});

test('+30 min collects more candy, using the extra time', () => {
  const [a, b] = run('more');
  assert.ok(b.candy > a.candy);
  assert.ok(b.totalSec > 90 * 60 && b.totalSec <= 120 * 60 + 1e-6);
});

test('reported time equals walking along the legs plus door time', () => {
  const [a] = run('none', 45);
  let walk = 0;
  for (const leg of a.legs) for (const k of leg) walk += s.g.sec[k];
  const door = a.stops.reduce((t, h) => t + h.doorSec, 0);
  assert.ok(Math.abs(walk + door - a.totalSec) < 1e-6);
});
