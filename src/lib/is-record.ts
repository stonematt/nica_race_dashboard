/**
 * Whether a value is a plain, indexable object — not `null`, not an array.
 *
 * Every module that decodes untrusted JSON (club config, RaceResult payloads,
 * ingest catalogs) narrows an `unknown` this way before treating it as a
 * record. Kept dependency-free on purpose: it has to run identically on the
 * Edge runtime, in Node, and under vitest.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
