import { Inject, Injectable } from '@nestjs/common';
import { conflictProblem, notFoundProblem } from '../http/problem';
import { buildRestaurantDocument } from './build-restaurant';
import type { CreateRestaurantInput } from './create-restaurant.schema';
import { buildListCriteria } from './list-criteria';
import type { ListQuery, SearchQuery } from './list-query.schema';
import { toResource, type RestaurantResource } from './restaurant.resource';
import { toListItem, type RestaurantListResponse } from './restaurant.list-item';
import type { RestaurantSearchResponse } from './restaurant.search-response';
import {
  DuplicateSourceError,
  RESTAURANT_STORE,
  type RestaurantStore,
} from './restaurant.store';
import { mergeSearch, summarizeSearch } from './search-query';
import { parseSearchText, type ParsedSearch } from './search-text';
import { VocabularyService } from './vocabulary.service';

/** What a request without a sentence says: nothing, so the parameters alone decide. */
const NO_TEXT: ParsedSearch = { filters: {}, words: [], locationWanted: false, notes: [], priceNotes: [], radiusNotes: [] };

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

  /**
   * The list, with a sentence. The sentence is read into the parameters of
   * `list` (see parseSearchText), the request's own parameters win where both
   * speak (see mergeSearch), and the same store query runs. The response is the
   * list's, plus `interpretation`, which says how the request was read.
   * `request` is already validated.
   */
  async search(tenantId: string, request: SearchQuery): Promise<RestaurantSearchResponse> {
    const started = performance.now();
    const vocabulary = await this.vocabulary.get(tenantId);
    const parsed = request.q === undefined ? NO_TEXT : parseSearchText(request.q, vocabulary);
    const merged = mergeSearch(request, parsed);

    const criteria = buildListCriteria(merged.query, vocabulary);
    if (merged.words.length > 0) criteria.textWords = merged.words;
    const { items, hasMore } = await this.store.list(tenantId, criteria);

    const notes = [...merged.notes];
    if (items.length === 0 && criteria.offset === 0 && merged.words.length > 0) {
      notes.push('No restaurant has all of these words in its name or area. Fewer words will match more.');
    }
    return {
      data: items.map(toListItem),
      page: { limit: criteria.limit, offset: criteria.offset, hasMore },
      meta: {
        sort: criteria.sort,
        order: criteria.order,
        tookMs: Math.round(performance.now() - started),
      },
      interpretation: {
        q: merged.q,
        summary: summarizeSearch(criteria),
        filters: merged.fromText,
        words: merged.words,
        overridden: merged.overridden,
        notes,
      },
    };
  }
}
