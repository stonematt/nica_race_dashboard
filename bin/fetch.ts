/**
 * Fetch RaceResult payloads into the append-only raw archive.
 *
 * STUB — the real implementation is issue #15, and it is blocked on issue #12
 * deciding how much deterministic ingest code to write. This file exists so the
 * entry point is real and provably runs with no build step.
 *
 * When it is written, three things are already decided and must hold:
 *
 *   1. Two API shapes. 2025 configs live at `/{id}/RRPublish/data/config`;
 *      the 2026 endpoint moved to `/{id}/results/config`, the list catalog
 *      moved inside the config as `Tab.Config.Lists`, and list names gained an
 *      `Online|` prefix. A 2026 config read with 2025 assumptions returns an
 *      empty catalog rather than an error — silent, so detection matters.
 *   2. Every fetch appends, including no-ops. Never update, never delete.
 *      `content_hash` differing for one (event_id, list_id) is a correction.
 *   3. Be polite. This is a volunteer-run nonprofit's timing vendor: serial
 *      requests, a real User-Agent, ~3s spacing, back off on any non-200.
 *
 * The 2025 season and the 2026 opener are ALREADY FETCHED and live in the tree
 * at `fixtures/`, gitignored and blocked at pre-commit (see docs/fixtures.md).
 * Resolve them with src/lib/fixtures.ts. Do not re-fetch them.
 */

console.log('bin/fetch.ts — stub. Implementation is issue #15, blocked on #12.');
