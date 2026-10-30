import { cleanRow } from './clean-row';
import {
  computeStats,
  type ImportStats,
  type RejectedRow,
} from './import-report';
import type { ImportedRestaurant } from './imported-restaurant';
import type {
  CollectionSummary,
  RestaurantSink,
  WriteTotals,
} from './restaurant-sink';
import type { TextFixes } from './text-fixes';
import type { ZomatoRow } from './zomato-csv';

export interface ImportSettings {
  /** Restaurants per bulk write. */
  batchSize: number;
}

export interface ImportOutcome {
  stats: ImportStats;
  rejected: RejectedRow[];
  /** Totals over all batches. Undefined for a dry run. */
  writes?: WriteTotals;
  /** What the tenant holds afterwards. Undefined for a dry run. */
  collection?: CollectionSummary;
}

/**
 * Cleans every row, then writes the accepted ones in batches. Without a sink
 * it is a dry run: the same cleaning and the same statistics, nothing written.
 *
 * Safe to run again: the sink upserts on tenant plus source system plus source
 * id, and a repeated id inside the file is rejected rather than written twice.
 */
export async function importRestaurants(
  rows: readonly ZomatoRow[],
  fixes: TextFixes,
  settings: ImportSettings,
  sink?: RestaurantSink,
): Promise<ImportOutcome> {
  if (!Number.isInteger(settings.batchSize) || settings.batchSize < 1) {
    throw new RangeError(
      `batchSize must be a whole number of at least 1, got ${settings.batchSize}`,
    );
  }

  const accepted: ImportedRestaurant[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const result = cleanRow(row, fixes);
    if (!result.ok) {
      rejected.push({ sourceId: result.sourceId, reason: result.reason });
      continue;
    }
    const id = result.restaurant.source.id;
    if (seen.has(id)) {
      rejected.push({
        sourceId: id,
        reason: 'duplicate Restaurant ID in the file',
      });
      continue;
    }
    seen.add(id);
    accepted.push(result.restaurant);
  }

  const stats = computeStats(rows.length, accepted, rejected.length);
  if (!sink) return { stats, rejected };

  const writes: WriteTotals = {
    inserted: 0,
    matched: 0,
    modified: 0,
    failures: [],
  };
  for (let start = 0; start < accepted.length; start += settings.batchSize) {
    const outcome = await sink.upsertBatch(
      accepted.slice(start, start + settings.batchSize),
    );
    writes.inserted += outcome.inserted;
    writes.matched += outcome.matched;
    writes.modified += outcome.modified;
    writes.failures.push(...outcome.failures);
  }
  return { stats, rejected, writes, collection: await sink.summarise() };
}
