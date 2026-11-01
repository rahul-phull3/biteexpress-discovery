import { Inject, Injectable } from '@nestjs/common';
import { RESTAURANT_STORE, type RestaurantStore } from './restaurant.store';
import type { Vocabulary } from './vocabulary';
import { VocabularyCache } from './vocabulary-cache';

/**
 * The cities and cuisines that exist, per tenant, kept for a minute. Listing
 * uses it to match what a person typed with what the data says; the natural
 * language search will use it to find a city or a cuisine inside a sentence.
 */
@Injectable()
export class VocabularyService {
  private readonly cache: VocabularyCache;

  constructor(@Inject(RESTAURANT_STORE) store: RestaurantStore) {
    this.cache = new VocabularyCache((tenantId) => store.vocabulary(tenantId));
  }

  get(tenantId: string): Promise<Vocabulary> {
    return this.cache.get(tenantId);
  }

  /** Call after a restaurant was created, so a new city or cuisine is known at once by this instance. */
  invalidate(tenantId: string): void {
    this.cache.invalidate(tenantId);
  }
}
