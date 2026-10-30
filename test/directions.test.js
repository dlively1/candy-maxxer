import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSteps, stepText, turnWord } from '../src/directions.js';
import { setup } from './helpers.js';
import { plan } from '../src/plan.js';

test('turn words follow the angle', () => {
  assert.equal(turnWord(5), 'continue');
  assert.equal(turnWord(90), 'right');
  assert.equal(turnWord(-90), 'left');
  assert.equal(turnWord(-40), 'slight left');
  assert.equal(turnWord(175), 'turn around');
});

test('real route yields readable steps covering every house and meter', async () => {
  const s = await setup();
  const [a] = plan({ g: s.g, houses: s.hs, startNode: s.startNode, budgetSec: 90 * 60, alt: 'none' });
  const steps = buildSteps(s.g, s.net, a.legs);
  assert.equal(steps[0].action, 'start');
  assert.equal(steps.reduce((n, x) => n + x.houses, 0), a.stops.length);
  assert.ok(Math.abs(steps.reduce((m, x) => m + x.m, 0) - a.distM) < 1);
  assert.ok(steps.length < 40, `${steps.length} steps is too many to read`);
  for (const x of steps) assert.match(stepText(x), /^(Start on|Turn|Continue onto)/);
  console.log('  ' + steps.map((x) => `${stepText(x)} (${Math.round(x.m)} m, ${x.houses})`).join('\n  '));
});
