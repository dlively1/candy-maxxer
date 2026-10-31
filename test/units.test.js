import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOsm, houseNumbers } from '../src/osm.js';
import { makeProjection } from '../src/geo.js';
import { candyValue } from '../src/candy.js';
import { START } from './helpers.js';

// Synthetic buildings in meters around (0, 0).
const proj = makeProjection(40, -80);
let id = 1;
const ring = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
  .map(([px, py]) => { const [lat, lon] = proj.toLatLon(px, py); return { lat, lon }; });
const building = (tags, x, y, w, h) => ({ type: 'way', id: id++, nodes: [], tags, geometry: ring(x, y, w, h) });
const point = (tags, x, y) => { const [lat, lon] = proj.toLatLon(x, y); return { type: 'node', id: id++, lat, lon, tags }; };
const parse = (elements) => parseOsm({ elements }, proj).houses;

test('house numbers: lists and ranges are several doors; letters and halves are one', () => {
  assert.deepEqual(houseNumbers('12'), ['12']);
  assert.deepEqual(houseNumbers('12;14'), ['12', '14']);
  assert.deepEqual(houseNumbers('12, 14'), ['12', '14']);
  assert.deepEqual(houseNumbers('12-16'), ['12', '14', '16']); // one side of the street
  assert.deepEqual(houseNumbers('12A'), ['12A']);
  assert.deepEqual(houseNumbers('12 1/2'), ['12 1/2']);
  assert.deepEqual(houseNumbers('100-200'), ['100-200']); // too wide to be one building's doors
});

test('a plain house is one door', () => {
  const [h] = parse([building({ building: 'house', 'addr:housenumber': '7', 'addr:street': 'Elm St' }, 0, 0, 10, 12)]);
  assert.equal(h.units, 1);
  assert.equal(h.address, '7 Elm St');
  assert.equal(h.street, 'Elm St');
});

test('a duplex: two house numbers on the building, or two address points inside it', () => {
  const [a] = parse([building({ building: 'house', 'addr:housenumber': '12;14', 'addr:street': 'Elm St' }, 0, 0, 16, 12)]);
  assert.equal(a.units, 2);
  assert.equal(a.address, '12, 14 Elm St');
  assert.equal(a.street, 'Elm St');
  const [b] = parse([
    building({ building: 'yes' }, 0, 0, 16, 12),
    point({ 'addr:housenumber': '20', 'addr:street': 'Oak St' }, 4, 6),
    point({ 'addr:housenumber': '22', 'addr:street': 'Oak St' }, 12, 6),
  ]);
  assert.equal(b.units, 2);
  assert.equal(b.street, 'Oak St');
  const [c] = parse([building({ building: 'duplex' }, 0, 0, 16, 12)]);
  assert.equal(c.units, 2);
});

test('a mapped flat count on a house counts its doors', () => {
  const [h] = parse([building({ building: 'house', 'building:flats': '3' }, 0, 0, 14, 12)]);
  assert.equal(h.units, 3);
});

test('apartments are one door, however many flats', () => {
  const [h] = parse([building({ building: 'apartments', 'building:flats': '40', 'addr:housenumber': '1-9' }, 0, 0, 40, 30)]);
  assert.ok(h, 'big apartment blocks are kept');
  assert.equal(h.units, 1);
});

test('a row of terraced houses: its addresses, else a guess from the footprint', () => {
  const row = parse([
    building({ building: 'terrace' }, 0, 0, 36, 11),
    ...[2, 4, 6, 8, 10, 12].map((n, k) => point({ 'addr:housenumber': String(n), 'addr:street': 'Row St' }, 3 + k * 6, 5)),
  ])[0];
  assert.equal(row.units, 6);
  const [bare] = parse([building({ building: 'terrace' }, 0, 0, 36, 11)]); // 396 m² ≈ 6 row houses
  assert.equal(bare.units, 6);
});

test('a stray address point outside any building still names the nearest house', () => {
  const [h] = parse([building({ building: 'house' }, 0, 0, 10, 10), point({ 'addr:housenumber': '5', 'addr:street': 'Elm St' }, 18, 5)]);
  assert.equal(h.units, 1);
  assert.equal(h.address, '5 Elm St');
});

test('candy scales with doors; dark is still nothing', () => {
  const one = { area: 120, units: 1 }, two = { area: 240, units: 2 };
  assert.equal(candyValue(two), 2 * candyValue(one));
  assert.equal(candyValue(two, 'dark'), 0);
  assert.equal(candyValue(two, 'star'), 12);
});

test('the Mount Washington fixture: duplexes counted, nothing lost', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/mt-washington.json', import.meta.url)));
  const houses = parseOsm(data, makeProjection(START.lat, START.lon)).houses;
  const multi = houses.filter((h) => h.units > 1);
  assert.ok(multi.length >= 10, `${multi.length} multi-door buildings`);
  assert.ok(houses.every((h) => h.units >= 1 && h.units <= 12));
});
