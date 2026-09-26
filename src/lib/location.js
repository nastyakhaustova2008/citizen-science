/**
 * Measurement location privacy: coordinates are rounded to COORD_DECIMALS (~100 m) before
 * they enter the wizard's state. The database rounds them again (trigger from migration 013),
 * so this is only for showing exactly what will be saved.
 */

export const COORD_DECIMALS = 3;

/**
 * Same result as Postgres round(x::numeric, 3): the double is read with 15 significant
 * digits (like float8 → numeric) and halves are rounded away from zero.
 */
export function roundCoord(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return n;
  const abs = Math.abs(n);
  if (abs < 1e-6) return 0;
  const digits = String(Number(abs.toPrecision(15)));
  const scaled = Math.round(Number(`${digits}e${COORD_DECIMALS}`));
  const r = Number(`${scaled}e-${COORD_DECIMALS}`);
  return n < 0 && r !== 0 ? -r : r;
}

/** [lat, lng] → rounded [lat, lng]. */
export function roundLatLng(lat, lng) {
  return [roundCoord(lat), roundCoord(lng)];
}

/** Display a measurement coordinate (always COORD_DECIMALS places). */
export function locationLabel(n) {
  return Number(n).toFixed(COORD_DECIMALS);
}
