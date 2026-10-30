// Tobler's hiking function: walking speed as a function of slope (dz/dx).
// Peaks at ~6 km/h on a slight downhill (-5%), ~5 km/h on flat ground.

export const PACES = {
  toddler: 0.6,
  kid: 0.85,
  teen: 1.0,
};

export function toblerKmh(slope) {
  return 6 * Math.exp(-3.5 * Math.abs(slope + 0.05));
}

// Seconds to walk a segment of horizontal length distM that rises dz meters.
export function walkSeconds(distM, dz, pace = 1) {
  if (distM <= 0) return 0;
  const slope = dz / distM;
  const mps = (toblerKmh(slope) * pace * 1000) / 3600;
  return Math.hypot(distM, dz) / mps;
}
