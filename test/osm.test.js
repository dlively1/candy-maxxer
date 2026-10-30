import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cellCenter, compactOsm, parseOsm, RADII } from '../src/osm.js';
import { makeProjection } from '../src/geo.js';
import { START } from './helpers.js';

const data = JSON.parse(readFileSync(new URL('./fixtures/mt-washington.json', import.meta.url)));
const M_PER_DEG = 111320;

test('GPS jitter of a few meters lands in the same cache cell', () => {
  const base = cellCenter(START.lat, START.lon);
  // Find the cell's center, then jitter around it by up to ±60 m.
  for (let i = 0; i < 50; i++) {
    const dLat = ((Math.random() - 0.5) * 120) / M_PER_DEG;
    const dLon = ((Math.random() - 0.5) * 120) / (M_PER_DEG * Math.cos((base[0] * Math.PI) / 180));
    assert.deepEqual(cellCenter(base[0] + dLat, base[1] + dLon), base);
  }
});

test('the cell center is always within ~150 m of the start (the download margin)', () => {
  for (let i = 0; i < 200; i++) {
    const lat = 40 + Math.random(), lon = -80 + Math.random();
    const [clat, clon] = cellCenter(lat, lon);
    const dx = (clon - lon) * M_PER_DEG * Math.cos((lat * Math.PI) / 180), dy = (clat - lat) * M_PER_DEG;
    assert.ok(Math.hypot(dx, dy) <= 150, `${Math.hypot(dx, dy)} m`);
  }
});

test('addresses a few blocks apart use different cells', () => {
  assert.notDeepEqual(cellCenter(START.lat, START.lon), cellCenter(START.lat + 400 / M_PER_DEG, START.lon));
});

test('compacting keeps everything the parser uses', () => {
  const proj = makeProjection(START.lat, START.lon);
  const before = parseOsm(data, proj), after = parseOsm(compactOsm(data), proj);
  assert.equal(after.ways.length, before.ways.length);
  assert.equal(after.houses.length, before.houses.length);
  assert.deepEqual(after.houses.map((h) => h.address), before.houses.map((h) => h.address));
  assert.deepEqual(after.ways.map((w) => [w.name, w.level]), before.ways.map((w) => [w.name, w.level]));
});

test('download sizes step up from small to large', () => {
  assert.deepEqual(RADII, [...RADII].sort((a, b) => a - b));
  assert.ok(RADII[0] <= 600);
});
