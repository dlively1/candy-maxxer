// Orienteering solver: visit the houses that maximize candy within a time budget, ending at home.
//
// Construction: greedy net-value-per-second insertion, tried with a few greed exponents.
// Improvement: asymmetric 2-opt + relocate, then iterated local search (tear out a stretch of
// the route, greedily rebuild, keep it if the haul improved).
//
// Real walking seconds (g.sec) always decide what fits in the budget. With `climb`, the solver
// is hill-averse: paths prefer flatter streets (+secPerMeter per meter gained) and every meter
// climbed is charged candyPerMeter against the haul, so a descent is only worth it if there's
// enough candy at the bottom to pay for the walk back up.
// Each house has a `value` the solver chases and a `candy` it reports (defaults to value).

import { dijkstra, pathEdges, climbAverse } from './graph.js';

export function solve({ g, houses, startNode, budgetSec, climb = null, timeMs, onProgress }) {
  // Measuring walking times takes roughly the first third of the work.
  const ctx = prepare({ g, houses, startNode, budgetSec, secPerMeter: climb?.secPerMeter,
    onProgress: onProgress && ((t) => onProgress({ t: t / 3, candy: 0 })) });
  return optimize(ctx, climb?.candyPerMeter ?? 0, { timeMs,
    onProgress: onProgress && ((p) => onProgress({ ...p, t: 1 / 3 + (2 / 3) * p.t })) });
}

// A route can only use so many houses; past ~5 per minute of budget, extra (farther) candidates
// only slow the search. Keep the closest ones.
const candidateCap = (budgetSec) => Math.round(Math.min(1000, Math.max(250, (budgetSec / 60) * 5)));

// Build the point-to-point walking-time matrices once; optimize() can then be run many times.
export function prepare({ g, houses, startNode, budgetSec, secPerMeter = 0, onProgress = null }) {
  const scoreSec = secPerMeter ? climbAverse(g, secPerMeter) : null;
  const run = (src) => dijkstra(g, src, { w: scoreSec || g.sec, aux: scoreSec ? g.sec : null });
  const real = (r) => r.aux || r.dist;
  const fromStart = run(startNode);

  // Candidates: reachable, worth something, and can be visited in a there-and-back trip.
  let cand = houses.filter((h) => h.value > 0 && real(fromStart)[h.node] + h.doorSec <= budgetSec);
  const cap = candidateCap(budgetSec);
  if (cand.length > cap) cand = cand.sort((a, b) => real(fromStart)[a.node] - real(fromStart)[b.node]).slice(0, cap);
  const from = new Map([[startNode, fromStart]]);
  const sources = [...new Set(cand.map((h) => h.node))];
  sources.forEach((v, i) => {
    if (!from.has(v)) from.set(v, run(v));
    if (onProgress && i % 25 === 0) onProgress(i / sources.length);
  });
  cand = cand.filter((h) => real(fromStart)[h.node] + h.doorSec + real(from.get(h.node))[startNode] <= budgetSec);

  // Point 0 is home; points 1..N-1 are candidate houses.
  const N = cand.length + 1;
  const pNode = [startNode, ...cand.map((h) => h.node)];
  const door = new Float64Array(N), value = new Float64Array(N), candy = new Float64Array(N);
  cand.forEach((h, i) => { door[i + 1] = h.doorSec; value[i + 1] = h.value; candy[i + 1] = h.candy ?? h.value; });
  const D = new Float64Array(N * N); // real seconds
  const P = scoreSec ? new Float64Array(N * N) : D; // score seconds (real + climb penalty)
  for (let i = 0; i < N; i++) {
    const r = from.get(pNode[i]);
    for (let j = 0; j < N; j++) {
      D[i * N + j] = real(r)[pNode[j]];
      if (scoreSec) P[i * N + j] = r.dist[pNode[j]];
    }
  }
  return { N, D, P, door, value, candy, budgetSec, cand, scoreSec, secPerMeter, lambda: 0 };
}

// candyPerMeter: how much candy one meter of climbing is "worth" giving up (0 = don't care).
// Local search runs until `timeMs` has passed or `iterations` perturbations were tried.
// onProgress({ t, candy }) reports search progress (0..1) and the best haul found so far.
export function optimize(prep, candyPerMeter = 0, { timeMs = 400, iterations = 300, onProgress = null } = {}) {
  const ctx = { ...prep, lambda: prep.secPerMeter ? candyPerMeter / prep.secPerMeter : 0 };
  let best = null;
  for (const alpha of [1, 0.75, 1.25, 1.6]) {
    const r = evaluate(ctx, construct(ctx, alpha));
    if (!best || better(r, best)) best = r;
  }
  const t0 = performance.now();
  const report = onProgress && ((r) => onProgress({
    t: Math.min(1, (performance.now() - t0) / timeMs),
    candy: r.route.reduce((s, p) => s + ctx.candy[p], 0),
  }));
  report?.(best);
  best = iteratedLocalSearch(ctx, best, iterations, t0 + timeMs, report);

  const { N, D, P, door, candy, cand, scoreSec, secPerMeter } = ctx;
  const route = best.route;
  return {
    stops: route.slice(1, -1).map((p) => cand[p - 1]),
    totalSec: routeCost(N, D, door, route),
    candy: route.reduce((s, p) => s + candy[p], 0),
    climbM: secPerMeter ? (routeCost(N, P, door, route) - routeCost(N, D, door, route)) / secPerMeter : null,
    considered: cand.length,
    scoreSec,
  };
}

const better = (a, b) => a.obj > b.obj + 1e-9 || (Math.abs(a.obj - b.obj) < 1e-9 && a.score < b.score - 1e-6);

function routeCost(N, M, door, r) {
  let s = 0;
  for (let k = 0; k + 1 < r.length; k++) s += M[r[k] * N + r[k + 1]] + door[r[k]];
  return s;
}

function evaluate(ctx, route) {
  const { N, D, P, door, value, lambda } = ctx;
  const sec = routeCost(N, D, door, route), score = routeCost(N, P, door, route);
  let obj = -lambda * (score - sec);
  for (const p of route) obj += value[p];
  return { route, obj, sec, score };
}

function construct(ctx, alpha, route = [0, 0]) {
  const used = new Uint8Array(ctx.N);
  for (const p of route) used[p] = 1;
  for (let round = 0; round < 20; round++) {
    const added = insertGreedy(ctx, route, used, alpha);
    const saved = twoOpt(ctx, route) + relocate(ctx, route);
    if (!added && saved < 1e-6) break;
  }
  return route;
}

// Perturb: drop a random stretch of stops, rebuild greedily, keep if better.
function iteratedLocalSearch(ctx, best, iterations, deadline, report) {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let it = 0; it < iterations && performance.now() < deadline; it++) {
    const r = best.route.slice();
    const L = r.length - 2;
    if (L < 2) break;
    const len = Math.max(1, Math.floor(L * (0.1 + 0.25 * rand())));
    const at = 1 + Math.floor(rand() * (L - len + 1));
    r.splice(at, len);
    const alpha = [1, 0.75, 1.25, 1.6][it % 4];
    const cand = evaluate(ctx, construct(ctx, alpha, r));
    if (better(cand, best)) best = cand;
    report?.(best);
  }
  return best;
}

// Repeatedly insert the house with the best net value per extra second that still fits.
// Net value = candy minus the price of any extra climbing the detour adds.
// Each house caches its best insertion edge (named by the stop it follows); an insertion only
// invalidates houses whose cached edge it split, everyone else just checks the two new edges.
function insertGreedy({ N, D, P, door, value, budgetSec, lambda }, route, used, alpha) {
  let sec = routeCost(N, D, door, route);
  const after = new Int32Array(N).fill(-1); // cached edge: insert after this stop
  const score = new Float64Array(N), real = new Float64Array(N);
  const next = new Int32Array(N);
  const link = () => { for (let k = 0; k + 1 < route.length; k++) next[route[k]] = route[k + 1]; };

  const tryEdge = (p, a) => {
    const b = next[a];
    const rd = D[a * N + p] + door[p] + D[p * N + b] - D[a * N + b];
    if (sec + rd > budgetSec) return;
    const net = P === D ? value[p]
      : value[p] - lambda * ((P[a * N + p] + P[p * N + b] - P[a * N + b]) - (rd - door[p]));
    if (net <= 0) return;
    const sc = net / Math.pow(Math.max(rd, 1), alpha);
    if (after[p] < 0 || sc > score[p]) { after[p] = a; score[p] = sc; real[p] = rd; }
  };
  const full = (p) => {
    after[p] = -1;
    for (let k = 0; k + 1 < route.length; k++) tryEdge(p, route[k]);
  };

  link();
  for (let p = 1; p < N; p++) if (!used[p]) full(p);
  let added = 0;
  for (;;) {
    let bestP = -1;
    for (let p = 1; p < N; p++) {
      if (used[p] || after[p] < 0) continue;
      if (bestP < 0 || score[p] > score[bestP]) bestP = p;
    }
    if (bestP < 0) return added;
    if (sec + real[bestP] > budgetSec + 1e-9) { full(bestP); continue; } // budget shrank since cached
    const a = after[bestP], b = next[a];
    route.splice(route.indexOf(a, 0) + 1, 0, bestP);
    next[a] = bestP; next[bestP] = b;
    used[bestP] = 1;
    sec += real[bestP];
    added++;
    for (let q = 1; q < N; q++) {
      if (used[q]) continue;
      if (after[q] === a) full(q);
      else { tryEdge(q, a); tryEdge(q, bestP); }
    }
  }
}

// Asymmetric 2-opt: reversing a stretch changes its internal cost (uphill vs downhill),
// so keep prefix sums of forward and backward leg times — for both cost matrices.
function twoOpt({ N, D, P, door, budgetSec }, route) {
  let total = 0;
  const prefix = (M, L) => {
    const f = new Float64Array(L), b = new Float64Array(L);
    for (let k = 1; k < L; k++) {
      f[k] = f[k - 1] + M[route[k - 1] * N + route[k]];
      b[k] = b[k - 1] + M[route[k] * N + route[k - 1]];
    }
    return [f, b];
  };
  // cost change of reversing route[i+1..j] under matrix M
  const delta = (M, f, b, i, j) => M[route[i] * N + route[j]] + (b[j] - b[i + 1]) + M[route[i + 1] * N + route[j + 1]]
    - (f[j + 1] - f[i]);
  for (let pass = 0; pass < 50; pass++) {
    const L = route.length;
    const [pf, pb] = prefix(P, L);
    const [df, db] = P === D ? [pf, pb] : prefix(D, L);
    const sec = routeCost(N, D, door, route);
    let bestGain = 1e-6, bi = -1, bj = -1;
    for (let i = 0; i < L - 3; i++) {
      for (let j = i + 2; j < L - 1; j++) {
        const gain = -delta(P, pf, pb, i, j);
        if (gain <= bestGain) continue;
        if (P !== D && sec + delta(D, df, db, i, j) > budgetSec) continue;
        bestGain = gain; bi = i; bj = j;
      }
    }
    if (bi < 0) break;
    const seg = route.slice(bi + 1, bj + 1).reverse();
    route.splice(bi + 1, seg.length, ...seg);
    total += bestGain;
  }
  return total;
}

// Move single stops to a cheaper spot in the route.
function relocate({ N, D, P, door, budgetSec }, route) {
  let total = 0;
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (let k = 1; k < route.length - 1; k++) {
      const p = route[k], a = route[k - 1], b = route[k + 1];
      const gainP = P[a * N + p] + P[p * N + b] - P[a * N + b];
      route.splice(k, 1);
      const slack = budgetSec - routeCost(N, D, door, route) - door[p];
      let bestPos = k, bestCost = gainP;
      for (let m = 0; m + 1 < route.length; m++) {
        const c = route[m], d = route[m + 1];
        const cost = P[c * N + p] + P[p * N + d] - P[c * N + d];
        if (cost >= bestCost - 1e-6) continue;
        if (P !== D && D[c * N + p] + D[p * N + d] - D[c * N + d] > slack) continue;
        bestCost = cost; bestPos = m + 1;
      }
      route.splice(bestPos, 0, p);
      if (bestPos !== k) { total += gainP - bestCost; improved = true; }
    }
    if (!improved) break;
  }
  return total;
}

// Turn the stop order into walkable geometry: one shortest path per leg (by the same costs).
export function routeLegs(g, startNode, stops, scoreSec = null) {
  const seq = [startNode, ...stops.map((h) => h.node), startNode];
  const legs = [];
  let prevSrc = -1, prev = null;
  for (let k = 0; k + 1 < seq.length; k++) {
    const a = seq[k], b = seq[k + 1];
    if (a === b) { legs.push([]); continue; }
    if (a !== prevSrc) { prev = dijkstra(g, a, { w: scoreSec || g.sec, prev: true }).prev; prevSrc = a; }
    legs.push(pathEdges(g, prev, b));
  }
  return legs;
}
