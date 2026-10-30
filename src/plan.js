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

export function plan({ g, houses, startNode, budgetSec, alt }) {
  const maxRun = solve({ g, houses, startNode, budgetSec });
  if (!ALTERNATIVES[alt]) return [finish(g, startNode, 'max', 'Max Candy', maxRun)];
  let b = alternative(maxRun);
  // The search is heuristic: if an alternative with the same time budget found more candy,
  // it is the real Max Candy route — promote it and plan the alternative again from there.
  if (alt !== 'more' && b.candy > maxRun.candy + 0.5) {
    const promoted = b.stops.map((h) => houses.find((x) => x.index === h.index));
    const r = { ...b, stops: promoted, scoreSec: null };
    b = alternative(r);
    return pair(r, b);
  }
  return pair(maxRun, b);

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
    return alt === 'easy' ? easier(a) : alt === 'fresh' ? fresh(a) : solve({ g, houses, startNode, budgetSec: budgetSec + 30 * 60 });
  }

  function easier(a) {
    const prep = prepare({ g, houses, startNode, budgetSec, secPerMeter: EASY_SEC_PER_M });
    const tries = EASY_CANDY_PER_M.map((c) => optimize(prep, c, { timeMs: 300 }));
    const ok = tries.filter((t) => t.candy >= EASY_MIN_SHARE * a.candy);
    return (ok.length ? ok : tries).reduce((x, y) => ((ok.length ? y.climbM < x.climbM : y.candy > x.candy) ? y : x));
  }

  function fresh(a) {
    const seen = new Set(a.stops.map((h) => h.index));
    const hs = houses.map((h) => (seen.has(h.index) ? { ...h, value: h.value * REPEAT_DISCOUNT, candy: h.value } : h));
    return solve({ g, houses: hs, startNode, budgetSec });
  }
}

