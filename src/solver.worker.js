// Runs the planner off the main thread so the map stays responsive.
import { plan } from './plan.js';

self.onmessage = ({ data }) => {
  try {
    const t0 = performance.now();
    let last = 0;
    const onProgress = (p) => { // ~15 updates/s is plenty for the loader
      const now = performance.now();
      if (now - last < 66 && p.phase !== 'done') return;
      last = now;
      self.postMessage({ seq: data.seq, progress: p });
    };
    const routes = plan({ ...data, onProgress }).map((r) => ({ ...r, stops: r.stops.map((h) => h.index) }));
    self.postMessage({ seq: data.seq, ok: true, routes, ms: performance.now() - t0 });
  } catch (e) {
    self.postMessage({ seq: data.seq, ok: false, error: e.message });
  }
};
