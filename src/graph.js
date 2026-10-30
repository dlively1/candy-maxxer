// Walking network: densified street graph with slope-aware, direction-dependent edge times.

import { Grid } from './geo.js';
import { walkSeconds } from './tobler.js';

const STEP_M = 20; // max spacing between graph nodes, so elevation is sampled along every street

// Merge OSM ways into an undirected network, splitting long segments into <= STEP_M pieces.
export function buildNetwork(ways, proj) {
  const lat = [], lon = [], x = [], y = [];
  const osmIndex = new Map();
  const names = [], nameIdx = new Map();
  const edges = []; // flat: a, b, lengthM, nameId
  const nodeNames = []; // node -> Set of name ids

  const addNode = (la, lo) => {
    const [px, py] = proj.toXY(la, lo);
    lat.push(la); lon.push(lo); x.push(px); y.push(py); nodeNames.push(new Set());
    return lat.length - 1;
  };
  const nameId = (n) => {
    if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); }
    return nameIdx.get(n);
  };

  for (const w of ways) {
    const nid = nameId(w.name);
    let prev = -1;
    for (let i = 0; i < w.coords.length; i++) {
      const osmId = w.nodes[i];
      let cur = osmIndex.get(osmId);
      if (cur === undefined) { cur = addNode(...w.coords[i]); osmIndex.set(osmId, cur); }
      nodeNames[cur].add(nid);
      if (prev >= 0) {
        const len = Math.hypot(x[cur] - x[prev], y[cur] - y[prev]);
        const pieces = Math.max(1, Math.ceil(len / STEP_M));
        let a = prev;
        for (let k = 1; k <= pieces; k++) {
          let b;
          if (k === pieces) b = cur;
          else {
            const t = k / pieces;
            b = addNode(lat[prev] + (lat[cur] - lat[prev]) * t, lon[prev] + (lon[cur] - lon[prev]) * t);
            nodeNames[b].add(nid);
          }
          edges.push(a, b, len / pieces, nid);
          a = b;
        }
      }
      prev = cur;
    }
  }

  const grid = new Grid(50);
  for (let i = 0; i < x.length; i++) grid.add(i, x[i], y[i]);
  return { n: x.length, lat, lon, x, y, edges, names, nameIdx, nodeNames, grid };
}

// Directed compressed adjacency. Uphill and downhill get different times (Tobler).
export function buildCSR(net, z, pace) {
  const { n, edges } = net;
  const deg = new Int32Array(n + 1);
  for (let i = 0; i < edges.length; i += 4) { deg[edges[i]]++; deg[edges[i + 1]]++; }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
  const fill = start.slice(0, n);
  const from = new Int32Array(start[n]);
  const to = new Int32Array(start[n]);
  const sec = new Float32Array(start[n]);
  const name = new Int32Array(start[n]);
  const rise = new Float32Array(start[n]);
  const len = new Float32Array(start[n]);
  for (let i = 0; i < edges.length; i += 4) {
    const a = edges[i], b = edges[i + 1], d = edges[i + 2], nm = edges[i + 3];
    const dz = z[b] - z[a];
    let k = fill[a]++; from[k] = a; to[k] = b; sec[k] = walkSeconds(d, dz, pace); name[k] = nm; rise[k] = dz; len[k] = d;
    k = fill[b]++; from[k] = b; to[k] = a; sec[k] = walkSeconds(d, -dz, pace); name[k] = nm; rise[k] = -dz; len[k] = d;
  }
  return { n, start, from, to, sec, name, rise, len };
}

// Snap each house to a street node (preferring its addressed street) and price the door detour:
// walk up the front path, ring the bell, walk back down.
export function attachHouses(net, houses, houseZ, z, { pace, porchSec }) {
  const out = [];
  houses.forEach((h, i) => {
    const street = h.address && h.address.replace(/^\S+\s+/, '');
    const sid = street && net.nameIdx.get(street);
    let snap = sid !== undefined && sid !== null
      ? net.grid.nearest(h.x, h.y, 120, (node) => net.nodeNames[node].has(sid))
      : null;
    if (!snap) snap = net.grid.nearest(h.x, h.y, 120);
    if (!snap) return;
    const path = Math.max(3, snap.dist - 11); // ~4m road half-width + ~7m from front door to centroid
    const dz = houseZ[i] - z[snap.id];
    const doorSec = walkSeconds(path, dz, pace) + walkSeconds(path, -dz, pace) + porchSec;
    out.push({ ...h, index: i, node: snap.id, doorSec, z: houseZ[i] });
  });
  return out;
}

// Binary-heap Dijkstra over edge weights w (default: real seconds).
// Returns { dist, prev, aux }: prev holds the CSR edge used to reach each node (if asked);
// aux sums a second weight array along the same shortest paths (if given).
export function dijkstra(g, src, { w = g.sec, prev: wantPrev = false, aux: auxW = null } = {}) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = wantPrev ? new Int32Array(g.n).fill(-1) : null;
  const aux = auxW ? new Float64Array(g.n).fill(Infinity) : null;
  if (aux) aux[src] = 0;
  const heapN = [], heapD = [];
  const push = (v, d) => {
    let i = heapN.length; heapN.push(v); heapD.push(d);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p] <= d) break;
      heapN[i] = heapN[p]; heapD[i] = heapD[p]; i = p;
    }
    heapN[i] = v; heapD[i] = d;
  };
  const pop = () => {
    const v = heapN[0], d = heapD[0];
    const ln = heapN.pop(), ld = heapD.pop();
    if (heapN.length) {
      let i = 0;
      const m = heapN.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= m) break;
        if (c + 1 < m && heapD[c + 1] < heapD[c]) c++;
        if (heapD[c] >= ld) break;
        heapN[i] = heapN[c]; heapD[i] = heapD[c]; i = c;
      }
      heapN[i] = ln; heapD[i] = ld;
    }
    return [v, d];
  };
  dist[src] = 0;
  push(src, 0);
  while (heapN.length) {
    const [u, d] = pop();
    if (d > dist[u]) continue;
    for (let k = g.start[u]; k < g.start[u + 1]; k++) {
      const v = g.to[k], nd = d + w[k];
      if (nd < dist[v]) {
        dist[v] = nd;
        if (prev) prev[v] = k;
        if (aux) aux[v] = aux[u] + auxW[k];
        push(v, nd);
      }
    }
  }
  return { dist, prev, aux };
}

// Walk prev pointers back from dst; returns list of CSR edge indices in travel order.
export function pathEdges(g, prev, dst) {
  const out = [];
  let v = dst;
  while (prev[v] >= 0) {
    const k = prev[v];
    out.push(k);
    v = g.from[k];
  }
  return out.reverse();
}

// Score weights that make climbing feel expensive: real seconds + a penalty per meter gained.
export function climbAverse(g, secPerMeter) {
  const s = new Float32Array(g.sec.length);
  for (let k = 0; k < s.length; k++) s[k] = g.sec[k] + secPerMeter * Math.max(0, g.rise[k]);
  return s;
}
