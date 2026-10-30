// Turn-by-turn steps from route legs: "Turn right onto Fernridge Drive · 420 ft · 12 houses".

const MINOR = new Set(['driveway', 'unnamed road']);

// Compass bearing of a CSR edge, degrees clockwise from north.
function bearing(net, g, k) {
  const a = g.from[k], b = g.to[k];
  return (Math.atan2(net.x[b] - net.x[a], net.y[b] - net.y[a]) * 180) / Math.PI;
}

const turnAngle = (h1, h2) => ((h2 - h1 + 540) % 360) - 180; // (-180, 180], + = right

export function turnWord(delta) {
  const d = Math.abs(delta);
  if (d < 25) return 'continue';
  if (d > 150) return 'turn around';
  const side = delta > 0 ? 'right' : 'left';
  return d < 60 ? `slight ${side}` : side;
}

// legs: arrays of CSR edge indices; a house stop follows every leg except the last.
// Returns [{ action, name, m, houses, edges: [k...] }].
export function buildSteps(g, net, legs) {
  const steps = [];
  let cur = null, lastHeading = null, lastMinor = false;
  const open = (action, name) => { cur = { action, name, m: 0, houses: 0, edges: [] }; steps.push(cur); };
  const firstEdge = legs.find((l) => l.length)?.[0];
  const firstName = firstEdge === undefined ? 'your street' : net.names[g.name[firstEdge]];

  legs.forEach((leg, i) => {
    for (const k of leg) {
      const name = net.names[g.name[k]];
      const minor = MINOR.has(name);
      const h = bearing(net, g, k);
      if (!cur) open('start', firstName);
      else if (!minor && !MINOR.has(cur.name) && name !== cur.name) {
        open(turnWord(turnAngle(lastHeading, h)), name);
        if (cur.action === 'continue') cur.action = 'continue onto';
      } else if (!minor && !lastMinor && lastHeading !== null && Math.abs(turnAngle(lastHeading, h)) > 150) {
        open('turn around', name);
      } else if (MINOR.has(cur.name) && !minor) {
        cur.name = name; // a step that began on a driveway takes the first real street name
      }
      cur.m += g.len[k];
      cur.edges.push(k);
      lastHeading = h;
      lastMinor = minor;
    }
    if (i < legs.length - 1) {
      if (!cur) open('start', firstName);
      cur.houses++;
    }
  });
  // Fold tiny house-less fragments (e.g. a 5 m jog at an intersection) into the step before.
  const out = [];
  for (const st of steps) {
    const prev = out.at(-1);
    if (prev && st.m < 12 && !st.houses) { prev.m += st.m; prev.edges.push(...st.edges); } else out.push(st);
  }
  return out;
}

export function stepText(s) {
  const on = s.name;
  switch (s.action) {
    case 'start': return `Start on ${on}`;
    case 'turn around': return `Turn around on ${on}`;
    case 'continue onto': return `Continue onto ${on}`;
    default: return `Turn ${s.action} onto ${on}`;
  }
}

// Where each "turn around" step begins, as an index into the route's points (point 0 is home,
// point j is the end of the j-th edge walked), so the map can mark the spot and time its reveal.
export function turnaroundPoints(steps) {
  const at = [];
  let walked = 0;
  for (const s of steps) {
    if (s.action === 'turn around') at.push(walked);
    walked += s.edges.length;
  }
  return at;
}
