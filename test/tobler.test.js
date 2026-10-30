import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toblerKmh, walkSeconds } from '../src/tobler.js';

test('flat ground is ~5 km/h, peak at -5%', () => {
  assert.ok(Math.abs(toblerKmh(0) - 5.04) < 0.01);
  assert.ok(Math.abs(toblerKmh(-0.05) - 6) < 1e-9);
});

test('uphill costs more than downhill', () => {
  const up = walkSeconds(100, 10, 1), down = walkSeconds(100, -5, 1), flat = walkSeconds(100, 0, 1);
  assert.ok(up > flat && flat > down);
  assert.ok(up > 1.3 * flat); // 10% grade is a real slog
});

test('slower walkers take longer', () => {
  assert.ok(walkSeconds(100, 0, 0.6) > walkSeconds(100, 0, 1));
});
