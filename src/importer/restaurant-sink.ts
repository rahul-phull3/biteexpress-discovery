import type { ImportedRestaurant } from './imported-restaurant';

/** A restaurant the database refused (for example the validator said no) or could not write. */
export interface WriteFailure {
  sourceId: string;
  message: string;
}

/** What one batch did. */
export interface BatchOutcome {
  /** New documents. */
  inserted: number;
  /** Existing documents that the upsert found. */
  matched: number;
  /** Existing documents whose content changed. */
  modified: number;
  failures: WriteFailure[];
}

/** The sum over all batches of a run. */
export type WriteTotals = BatchOutcome;

/** What is stored for the tenant after the run. */
export interface CollectionSummary {
  documents: number;
  withLocation: number;
}

/**
 * Where cleaned restaurants go. The import logic only knows this interface, so
 * it can be tested without a database, and a dry run simply has no sink.
 */
export interface RestaurantSink {
  /** Writes one batch. Rows the database refuses are reported in failures, not thrown. */
  upsertBatch(batch: readonly ImportedRestaurant[]): Promise<BatchOutcome>;
  /** Counts the tenant's imported documents. */
  summarise(): Promise<CollectionSummary>;
}
