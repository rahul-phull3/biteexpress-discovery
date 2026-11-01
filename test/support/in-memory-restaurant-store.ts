import type { ListCriteria } from '../../src/restaurants/list-criteria';
import type { RestaurantDocument } from '../../src/restaurants/restaurant.document';
import {
  DuplicateSourceError,
  type ListResult,
  type RestaurantStore,
  type StoredRestaurant,
} from '../../src/restaurants/restaurant.store';
import type { VocabularyData } from '../../src/restaurants/vocabulary';
import { listFrom, vocabularyFrom } from './in-memory-listing';

/**
 * A RestaurantStore that keeps restaurants in memory, for tests of the service
 * and of the HTTP layer that must not need a database. It keeps the rules the
 * service relies on: an id is 24 hexadecimal characters, a (tenant, source)
 * pair is unique, a read only sees the asking tenant's restaurants, and a
 * listing filters and orders the way the MongoDB queries do (in-memory-listing.ts).
 *
 * restaurant-store.contract.ts holds the checks that this class and the
 * MongoDB store both pass, so this stand-in cannot quietly drift away from the
 * real one.
 */
export class InMemoryRestaurantStore implements RestaurantStore {
  private readonly rows: StoredRestaurant[] = [];
  private nextId = 1;

  /** How many restaurants the tenant has. */
  countFor(tenantId: string): number {
    return this.rows.filter((row) => row.doc.tenantId === tenantId).length;
  }

  // Copies go in and out, as they would across a database connection, so a
  // test can never change a stored restaurant by editing what it was given.
  async insert(doc: RestaurantDocument): Promise<StoredRestaurant> {
    const { source } = doc;
    if (
      source &&
      this.rows.some(
        (row) =>
          row.doc.tenantId === doc.tenantId &&
          row.doc.source?.system === source.system &&
          row.doc.source?.id === source.id,
      )
    ) {
      throw new DuplicateSourceError(source);
    }
    const row: StoredRestaurant = {
      id: (this.nextId++).toString(16).padStart(24, '0'),
      doc: structuredClone(doc),
    };
    this.rows.push(row);
    return structuredClone(row);
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<StoredRestaurant | null> {
    const row = this.rows.find(
      (candidate) => candidate.id === id && candidate.doc.tenantId === tenantId,
    );
    return row ? structuredClone(row) : null;
  }

  async list(tenantId: string, criteria: ListCriteria): Promise<ListResult> {
    return listFrom(this.rows, tenantId, criteria);
  }

  async vocabulary(tenantId: string): Promise<VocabularyData> {
    return vocabularyFrom(this.rows, tenantId);
  }
}
