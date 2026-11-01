import type { ListCriteria } from './list-criteria';
import type { RestaurantDocument } from './restaurant.document';
import type { VocabularyData } from './vocabulary';

/** A stored restaurant with its public id (the MongoDB _id as 24 hexadecimal characters). */
export interface StoredRestaurant {
  id: string;
  doc: RestaurantDocument;
}

/** The fields of a restaurant that a listing shows; the rest never leaves the database. */
export type ListedFields = Pick<
  RestaurantDocument,
  'name' | 'address' | 'cuisines' | 'cost' | 'rating'
>;

/** One row of a listing. */
export interface ListedRestaurant {
  id: string;
  doc: ListedFields;
  /** Kilometres from the requested point, rounded to 10 metres. Present only when the criteria had a point. */
  distanceKm?: number;
}

/** One page of a listing. */
export interface ListResult {
  items: ListedRestaurant[];
  /** Whether at least one more restaurant follows this page. */
  hasMore: boolean;
}

/** The inserted restaurant carries a source that another restaurant of the tenant already has. */
export class DuplicateSourceError extends Error {
  constructor(readonly source: { system: string; id: string }) {
    super(`source ${source.system}/${source.id} already exists`);
    this.name = 'DuplicateSourceError';
  }
}

/**
 * What the service needs from storage. A port, so the service is tested with
 * an in-memory store (test/support) and runs on MongoDB in production
 * (mongo-restaurant.store.ts). Both pass the same contract tests
 * (test/support/restaurant-store.contract.ts).
 */
export interface RestaurantStore {
  /** Stores the restaurant and returns it with its new id. Throws DuplicateSourceError. */
  insert(doc: RestaurantDocument): Promise<StoredRestaurant>;
  /** The restaurant with this id that belongs to this tenant, or null. */
  findById(tenantId: string, id: string): Promise<StoredRestaurant | null>;
  /**
   * One page of the tenant's active restaurants that match the criteria, in the
   * order the criteria ask for. Rules every store follows:
   *  - ties keep a fixed order (by id), so pages never overlap or skip a
   *    restaurant. The one exception: restaurants at exactly the same distance
   *    from the point come back in the order the geo search yields, which
   *    MongoDB does not promise (see buildMongoListQuery);
   *  - restaurants without coordinates never match a criteria with a point;
   *  - an ascending sort leaves out restaurants that lack the value being
   *    sorted; a descending sort puts them last;
   *  - sorting by distance without a point is a programming error and throws.
   */
  list(tenantId: string, criteria: ListCriteria): Promise<ListResult>;
  /** Every city and cuisine of the tenant's active restaurants, with how many restaurants have each. */
  vocabulary(tenantId: string): Promise<VocabularyData>;
}

/** Dependency-injection token of the RestaurantStore. */
export const RESTAURANT_STORE = Symbol('RESTAURANT_STORE');
