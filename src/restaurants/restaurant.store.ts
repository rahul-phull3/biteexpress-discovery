import type { RestaurantDocument } from './restaurant.document';

/** A stored restaurant with its public id (the MongoDB _id as 24 hexadecimal characters). */
export interface StoredRestaurant {
  id: string;
  doc: RestaurantDocument;
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
 * (mongo-restaurant.store.ts). Later steps add the listing queries here.
 */
export interface RestaurantStore {
  /** Stores the restaurant and returns it with its new id. Throws DuplicateSourceError. */
  insert(doc: RestaurantDocument): Promise<StoredRestaurant>;
  /** The restaurant with this id that belongs to this tenant, or null. */
  findById(tenantId: string, id: string): Promise<StoredRestaurant | null>;
}

/** Dependency-injection token of the RestaurantStore. */
export const RESTAURANT_STORE = Symbol('RESTAURANT_STORE');
