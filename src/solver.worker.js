// Runs the planner off the main thread so the map stays responsive.
import { plan } from './plan.js';

self.onmessage = ({ data }) => {
  try {
    const t0 = performance.now();
    const routes = plan(data).map((r) => ({ ...r, stops: r.stops.map((h) => h.index) }));
    self.postMessage({ seq: data.seq, ok: true, routes, ms: performance.now() - t0 });
  } catch (e) {
    self.postMessage({ seq: data.seq, ok: false, error: e.message });
  }
};
