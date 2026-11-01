import { Logger } from '@nestjs/common';
import type { Collection, Db, Document, ObjectId } from 'mongodb';
import { describeError } from '../database/mongo-errors';
import { RESTAURANTS_COLLECTION } from '../database/restaurants.collection';
import { checkSearchIndex } from '../health/readiness';
import { buildTextSearchPipeline } from './atlas-text-query';
import { RulesTextSearch, type TextSearch } from './text-search';

/** How long "the search index is ready" is believed before it is checked again. */
export const READY_VERDICT_MS = 30_000;
/** How long "it is not ready" is believed. Short, so that a finished build is noticed quickly. */
export const NOT_READY_VERDICT_MS = 5_000;

/**
 * TextSearch on Atlas Search: names the restaurants that the words of a
 * sentence fit, using the `restaurants_search` index.
 *
 * It asks the database whether that index is ready before it searches, because
 * Atlas answers a search on an index that is missing or still being built with
 * no results at all, not with an error. Taking that for "nothing matches" would
 * be a wrong answer. A deployment without Atlas Search, an index that is still
 * building, a failed search and a search that runs past its time limit all end
 * the same way: `null`, and the caller uses the plain rules instead.
 *
 * Atlas Search indexes a new restaurant a moment after it was written, so a
 * restaurant that was added a second ago may not be found by its words yet.
 */
export class AtlasTextSearch implements TextSearch {
  readonly engine = 'atlas';

  private readonly restaurants: Collection<Document>;
  private readonly logger = new Logger(AtlasTextSearch.name);
  /** What the last check of the index found, and until when it is believed. */
  private verdict: { ready: boolean; until: number } | undefined;
  /** A check in progress, shared by the requests that arrive meanwhile. */
  private checking: Promise<boolean> | undefined;

  constructor(
    private readonly db: Db,
    /** The time limit of every call to the database, in milliseconds. */
    private readonly timeoutMs: number,
    /** The clock; a test passes its own. */
    private readonly now: () => number = Date.now,
  ) {
    this.restaurants = db.collection<Document>(RESTAURANTS_COLLECTION);
  }

  async candidates(tenantId: string, words: readonly string[]): Promise<string[] | null> {
    if (!(await this.indexIsReady())) return null;
    try {
      const rows = await this.restaurants
        .aggregate<{ _id: ObjectId }>(buildTextSearchPipeline(tenantId, words), {
          maxTimeMS: this.timeoutMs,
        })
        .toArray();
      return rows.map((row) => row._id.toHexString());
    } catch (error) {
      // Look at the index again on the next search: the failure may be a restart of the search process.
      this.verdict = undefined;
      this.logger.warn(
        `Atlas Search failed, so the words are matched as plain text instead. ${describeError(error)}`,
      );
      return null;
    }
  }

  private async indexIsReady(): Promise<boolean> {
    const known = this.verdict;
    if (known && this.now() < known.until) return known.ready;
    // Searches that arrive while the check runs share it instead of each asking the database.
    this.checking ??= this.checkIndex().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async checkIndex(): Promise<boolean> {
    const { queryable } = await checkSearchIndex(this.db, this.timeoutMs);
    this.verdict = {
      ready: queryable,
      until: this.now() + (queryable ? READY_VERDICT_MS : NOT_READY_VERDICT_MS),
    };
    return queryable;
  }
}

/** The engine that the SEARCH_ENGINE setting asks for. */
export function createTextSearch(
  db: Db,
  settings: { engine: 'atlas' | 'rules'; timeoutMs: number },
): TextSearch {
  return settings.engine === 'atlas'
    ? new AtlasTextSearch(db, settings.timeoutMs)
    : new RulesTextSearch();
}
