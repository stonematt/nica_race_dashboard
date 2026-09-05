/**
 * Whether a value is a plain, indexable object — not `null`, not an array.
 *
 * Every module that decodes untrusted JSON (club config, RaceResult payloads,
 * ingest catalogs) narrows an `unknown` this way before treating it as a
 * record. None of today's four call sites run on the Edge runtime — several
 * import Node built-ins directly — but this file itself stays free of imports
 * so a future Edge-reachable caller (a route config, say) can pull it in
 * without dragging a Node dependency along for the ride.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
