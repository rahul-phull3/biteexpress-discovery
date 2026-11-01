import { Inject, Injectable } from '@nestjs/common';
import { conflictProblem, notFoundProblem } from '../http/problem';
import { buildRestaurantDocument } from './build-restaurant';
import type { CreateRestaurantInput } from './create-restaurant.schema';
import { toResource, type RestaurantResource } from './restaurant.resource';
import {
  DuplicateSourceError,
  RESTAURANT_STORE,
  type RestaurantStore,
} from './restaurant.store';

/** The use cases of the restaurant resource. Later steps add listing and search. */
@Injectable()
export class RestaurantsService {
  constructor(
    @Inject(RESTAURANT_STORE) private readonly store: RestaurantStore,
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
      return toResource(await this.store.insert(doc));
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
}
