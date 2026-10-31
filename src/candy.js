// The candy model: a guess, deliberately simple and overridable per house.

export const OVERRIDES = ['normal', 'star', 'dark'];

// Per door; a duplex or a row of houses has several (house.units).
export function candyValue(house, override = 'normal') {
  if (override === 'dark') return 0;
  const units = house.units || 1;
  if (override === 'star') return 6 * units; // full-size bar house
  // Base 2 pieces; bigger homes skew generous, up to +1.
  return units * (2 + Math.min(1, Math.max(0, (house.area / units - 150) / 350)));
}
