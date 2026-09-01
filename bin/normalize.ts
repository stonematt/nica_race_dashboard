/**
 * Decode archived payloads into the source-mirroring tables.
 *
 * STUB — the real implementation is issue #16. This file exists so the entry
 * point is real and provably runs with no build step.
 *
 * When it is written, these hold:
 *
 *   1. Reads `raw_fetch` only. No network. Latest row per (event_id, list_id):
 *      `distinct on (event_id, list_id) order by fetched_at desc`.
 *   2. Decoding is positional, per event, per list, via
 *      `DataFields.indexOf(field.Expression)` taken from `list.Fields[]`.
 *      Never zip Fields to DataFields — different lengths. Never cache a column
 *      index across events; the layout drifts five ways within one season.
 *   3. Idempotent: upsert on the natural key, so running twice is a no-op.
 *   4. Fidelity, not calculation. NICA is the scoring authority — places,
 *      points, ranks and season totals land unaltered. Nothing is computed,
 *      corrected or merged on the way in.
 */

console.log('bin/normalize.ts — stub. Implementation is issue #16.');
