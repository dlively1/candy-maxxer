// The candy model: a guess, deliberately simple and overridable per house.

export const OVERRIDES = ['normal', 'star', 'dark'];

export function candyValue(house, override = 'normal') {
  if (override === 'dark') return 0;
  if (override === 'star') return 6; // full-size bar house
  // Base 2 pieces; bigger footprints skew generous, up to +1.
  return 2 + Math.min(1, Math.max(0, (house.area - 150) / 350));
}
