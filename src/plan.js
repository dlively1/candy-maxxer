// Plan the Max Candy route plus one alternative to compare against.

import { solve, prepare, optimize, routeLegs } from './solver.js';

// "Easier legs": paths prefer flatter streets (+20 s per meter gained), and climbing is charged
// against the haul at a few strengths. Pick the least climbing that keeps >= 85% of the candy.
const EASY_SEC_PER_M = 20;
const EASY_CANDY_PER_M = [0.15, 0.4];
const EASY_MIN_SHARE = 0.85;
// Revisited houses are worth this fraction in the "different streets" alternative.
const REPEAT_DISCOUNT = 0.1;

export const ALTERNATIVES = {
  easy: 'Easier legs',
  fresh: 'Different streets',
  more: '+30 min',
};

// Distance, climb and walking time actually covered along a route's legs.
export function legStats(g, legs) {
  let distM = 0, climbM = 0, walkSec = 0;
  for (const leg of legs) for (const k of leg) { distM += g.len[k]; climbM += Math.max(0, g.rise[k]); walkSec += g.sec[k]; }
  return { distM, climbM, walkSec };
}

const finish = (g, startNode, key, label, r) => {
  const legs = routeLegs(g, startNode, r.stops, r.scoreSec);
  const { distM, climbM, walkSec } = legStats(g, legs);
  const totalSec = walkSec + r.stops.reduce((s, h) => s + h.doorSec, 0);
  return { key, label, stops: r.stops, totalSec, candy: r.candy, considered: r.considered, legs, distM, climbM };
};

// onProgress({ phase, frac, candy }): overall progress 0..1 and the best Max Candy haul so far.
export function plan({ g, houses, startNode, budgetSec, alt, onProgress = () => {} }) {
  const single = !ALTERNATIVES[alt];
  let best = 0;
  const phase = (name, from, to) => ({ t, candy }) => {
    if (name === 'max') best = Math.max(best, candy);
    onProgress({ phase: name, frac: from + (to - from) * t, candy: best });
  };
  const maxRun = solve({ g, houses, startNode, budgetSec, onProgress: phase('max', 0.05, single ? 0.9 : 0.45) });
  if (single) return done([finish(g, startNode, 'max', 'Max Candy', maxRun)]);
  const altPhase = phase('alt', 0.45, 0.9);
  let b = alternative(maxRun);
  // The search is heuristic: if an alternative with the same time budget found more candy,
  // it is the real Max Candy route — promote it and plan the alternative again from there.
  if (alt !== 'more' && b.candy > maxRun.candy + 0.5) {
    const promoted = b.stops.map((h) => houses.find((x) => x.index === h.index));
    const r = { ...b, stops: promoted, scoreSec: null };
    best = r.candy;
    b = alternative(r);
    return done(pair(r, b));
  }
  return done(pair(maxRun, b));

  function done(routes) {
    onProgress({ phase: 'done', frac: 1, candy: routes[0].candy });
    return routes;
  }

  function pair(ra, rb) {
    const a = finish(g, startNode, 'max', 'Max Candy', ra);
    const out = finish(g, startNode, alt, ALTERNATIVES[alt], rb);
    // An "easier" route that isn't at least 10 ft flatter isn't worth showing.
    if (alt === 'easy' && out.climbM > a.climbM - 3) {
      a.note = 'No flatter route nearby: Max Candy is already about as easy as it gets here.';
      return [a];
    }
    return [a, out];
  }

  function alternative(a) {
    return alt === 'easy' ? easier(a) : alt === 'fresh' ? fresh(a)
      : solve({ g, houses, startNode, budgetSec: budgetSec + 30 * 60, onProgress: altPhase });
  }

  function easier(a) {
    const prep = prepare({ g, houses, startNode, budgetSec, secPerMeter: EASY_SEC_PER_M });
    const tries = EASY_CANDY_PER_M.map((c, i) => optimize(prep, c, {
      timeMs: 300, onProgress: ({ t }) => altPhase({ t: (i + t) / EASY_CANDY_PER_M.length, candy: 0 }),
    }));
    const ok = tries.filter((t) => t.candy >= EASY_MIN_SHARE * a.candy);
    return (ok.length ? ok : tries).reduce((x, y) => ((ok.length ? y.climbM < x.climbM : y.candy > x.candy) ? y : x));
  }

  function fresh(a) {
    const seen = new Set(a.stops.map((h) => h.index));
    const hs = houses.map((h) => (seen.has(h.index) ? { ...h, value: h.value * REPEAT_DISCOUNT, candy: h.value } : h));
    return solve({ g, houses: hs, startNode, budgetSec, onProgress: (p) => altPhase({ ...p, candy: 0 }) });
  }
}

