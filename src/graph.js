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
  const levels = []; // node chains of bridges/tunnels, whose elevation gets straightened later

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
    const chain = w.level ? [] : null;
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
          if (chain) { if (!chain.length) chain.push(a); chain.push(b); }
          a = b;
        }
      }
      prev = cur;
    }
    if (chain?.length > 2) levels.push(chain);
  }

  const grid = new Grid(50);
  for (let i = 0; i < x.length; i++) grid.add(i, x[i], y[i]);
  const n = x.length;
  const { comp, size, main } = components(n, edges);
  // Routes stay on one connected network: OSM often has stray fragments (a highway ramp, a lone
  // footpath) that would strand a route there. The largest one until anchor() picks the start's.
  let home = main;
  const walkable = (node) => comp[node] === home;
  // Start on the network around (x0, y0): the nearest street point whose network is a real one,
  // at least a quarter the size of the biggest within reach. A private driveway stub can't strand
  // the route, but a subdivision that only meets the rest across a no-walking highway still works.
  // Returns { id, dist } (and makes that network the walkable one) or null.
  const anchor = (x0, y0, maxDist = 400) => {
    let big = 0;
    grid.within(x0, y0, maxDist, (id) => { big = Math.max(big, size[comp[id]]); });
    const snap = big ? grid.nearest(x0, y0, maxDist, (id) => size[comp[id]] * 4 >= big) : null;
    if (snap) home = comp[snap.id];
    return snap;
  };
  return { n, lat, lon, x, y, edges, names, nameIdx, nodeNames, grid, walkable, anchor, levels };
}

// Union-find over the undirected edges; returns each node's component, sizes by component, and the largest.
function components(n, edges) {
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let i = 0; i < edges.length; i += 4) {
    const a = find(edges[i]), b = find(edges[i + 1]);
    if (a !== b) parent[a] = b;
  }
  const comp = new Int32Array(n), size = new Int32Array(n);
  for (let i = 0; i < n; i++) { comp[i] = find(i); size[comp[i]]++; }
  let main = -1, best = -1;
  for (let c = 0; c < n; c++) if (size[c] > best) { best = size[c]; main = c; }
  return { comp, size, main };
}

// Bridges and tunnels: replace the sampled ground elevation along each with a straight ramp
// between its two ends (mutates z). Otherwise a bridge "dives" into the valley under it and a
// tunnel "climbs" the hill above it.
export function levelStructures(net, z) {
  for (const chain of net.levels) {
    const d = [0];
    for (let i = 1; i < chain.length; i++) {
      d.push(d[i - 1] + Math.hypot(net.x[chain[i]] - net.x[chain[i - 1]], net.y[chain[i]] - net.y[chain[i - 1]]));
    }
    const z0 = z[chain[0]], z1 = z[chain.at(-1)], total = d.at(-1) || 1;
    for (let i = 1; i < chain.length - 1; i++) z[chain[i]] = z0 + (z1 - z0) * (d[i] / total);
  }
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
      ? net.grid.nearest(h.x, h.y, 120, (node) => net.walkable(node) && net.nodeNames[node].has(sid))
      : null;
    if (!snap) snap = net.grid.nearest(h.x, h.y, 120, net.walkable);
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
