/**
 * The one shape an ingest failure takes.
 *
 * Ingest is strict on purpose: an unreadable config, an unplaceable payload, an
 * unrecognized expression — none of them are recoverable, and none may be
 * downgraded into a null column or a skipped row. So every failure here is a
 * throw, and the only thing subclasses add is a name a caller can match on.
 */
export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
