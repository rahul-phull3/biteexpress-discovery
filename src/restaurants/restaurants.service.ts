import { Inject, Injectable } from '@nestjs/common';
import { conflictProblem, notFoundProblem } from '../http/problem';
import { buildRestaurantDocument } from './build-restaurant';
import type { CreateRestaurantInput } from './create-restaurant.schema';
import { buildListCriteria } from './list-criteria';
import type { ListQuery } from './list-query.schema';
import { toResource, type RestaurantResource } from './restaurant.resource';
import { toListItem, type RestaurantListResponse } from './restaurant.list-item';
import {
  DuplicateSourceError,
  RESTAURANT_STORE,
  type RestaurantStore,
} from './restaurant.store';
import { VocabularyService } from './vocabulary.service';

/** The use cases of the restaurant resource. Natural language search is added on top of `list`. */
@Injectable()
export class RestaurantsService {
  constructor(
    @Inject(RESTAURANT_STORE) private readonly store: RestaurantStore,
    private readonly vocabulary: VocabularyService,
  ) {}

  /**
   * Creates a restaurant for a tenant. A restaurant that names a source
   * (system and id) which the tenant already has is refused with a 409, so a
   * caller that retries after a timeout does not create a second copy.
   */
  async create(
    tenantId: string,
    input: CreateRestaurantInput,
    now: Date = new Date(),
  ): Promise<RestaurantResource> {
    const doc = buildRestaurantDocument(input, { tenantId, now });
    try {
      const created = toResource(await this.store.insert(doc));
      // The restaurant may have a city or cuisine this instance has not seen.
      this.vocabulary.invalidate(tenantId);
      return created;
    } catch (error) {
      if (error instanceof DuplicateSourceError) {
        throw conflictProblem(
          `A restaurant with source ${error.source.system}/${error.source.id} already exists.`,
          [
            {
              pointer: '#/source',
              detail: 'This source id is already used by another restaurant.',
            },
          ],
        );
      }
      throw error;
    }
  }

  /** One restaurant of the tenant, or a 404 problem. `id` is already validated. */
  async get(tenantId: string, id: string): Promise<RestaurantResource> {
    const stored = await this.store.findById(tenantId, id);
    if (!stored) throw notFoundProblem(`No restaurant has the id ${id}.`);
    return toResource(stored);
  }

  /** One page of the tenant's restaurants. `query` is already validated. */
  async list(tenantId: string, query: ListQuery): Promise<RestaurantListResponse> {
    const started = performance.now();
    const criteria = buildListCriteria(query, await this.vocabulary.get(tenantId));
    const { items, hasMore } = await this.store.list(tenantId, criteria);
    return {
      data: items.map(toListItem),
      page: { limit: criteria.limit, offset: criteria.offset, hasMore },
      meta: {
        sort: criteria.sort,
        order: criteria.order,
        tookMs: Math.round(performance.now() - started),
      },
    };
  }
}
