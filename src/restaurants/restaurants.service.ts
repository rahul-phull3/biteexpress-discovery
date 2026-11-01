import { Inject, Injectable, Optional } from '@nestjs/common';
import { conflictProblem, notFoundProblem } from '../http/problem';
import { buildRestaurantDocument } from './build-restaurant';
import type { CreateRestaurantInput } from './create-restaurant.schema';
import { buildListCriteria, type ListCriteria } from './list-criteria';
import type { ListQuery, SearchQuery } from './list-query.schema';
import { toResource, type RestaurantResource } from './restaurant.resource';
import { toListItem, type RestaurantListResponse } from './restaurant.list-item';
import type {
  RestaurantSearchResponse,
  SearchInterpretation,
} from './restaurant.search-response';
import {
  DuplicateSourceError,
  RESTAURANT_STORE,
  type RestaurantStore,
} from './restaurant.store';
import { mergeSearch, summarizeSearch } from './search-query';
import { parseSearchText, type ParsedSearch } from './search-text';
import { RULES_ONLY, TEXT_SEARCH, type TextSearch } from './text-search';
import { VocabularyService } from './vocabulary.service';

/** What a request without a sentence says: nothing, so the parameters alone decide. */
const NO_TEXT: ParsedSearch = { filters: {}, words: [], locationWanted: false, notes: [], priceNotes: [], radiusNotes: [] };

/** The use cases of the restaurant resource. Natural language search is added on top of `list`. */
@Injectable()
export class RestaurantsService {
  constructor(
    @Inject(RESTAURANT_STORE) private readonly store: RestaurantStore,
    private readonly vocabulary: VocabularyService,
    /** How the leftover words of a sentence are matched. Without one, the plain rules. */
    @Optional() @Inject(TEXT_SEARCH) private readonly textSearch: TextSearch = RULES_ONLY,
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
    const notes = [...merged.notes];
    const textSearch = await this.matchWords(tenantId, merged.words, criteria, notes);
    const { items, hasMore } = await this.store.list(tenantId, criteria);

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
        // The words are named in the summary however they were matched.
        summary: summarizeSearch({ ...criteria, textWords: merged.words }),
        filters: merged.fromText,
        words: merged.words,
        overridden: merged.overridden,
        notes,
        ...(textSearch ? { textSearch } : {}),
      },
    };
  }

  /**
   * Decides how the leftover words of the sentence are matched, and puts the
   * decision into the criteria:
   *  - Atlas Search named restaurants: `candidateIds`, and the listing runs on those.
   *  - Atlas Search is off, or could not answer: `textWords`, and the listing
   *    keeps the restaurants whose name or area contains each word.
   * Returns what the client is told about it, which is nothing unless Atlas Search was tried.
   */
  private async matchWords(
    tenantId: string,
    words: string[],
    criteria: ListCriteria,
    notes: string[],
  ): Promise<SearchInterpretation['textSearch']> {
    if (words.length === 0) return undefined;
    if (this.textSearch.engine !== 'atlas') {
      criteria.textWords = words;
      return undefined;
    }

    const ids = await this.textSearch.candidates(tenantId, words).catch(() => null);
    if (ids !== null) {
      criteria.candidateIds = ids;
      notes.push(
        `The words "${words.join(' ')}" were matched by Atlas Search in the name and the area: whole words, the start of a word, and one typo are accepted.`,
      );
      return { engine: 'atlas', degraded: false };
    }
    criteria.textWords = words;
    notes.push('Atlas Search could not answer, so the words were matched as plain text in the name or area.');
    return { engine: 'rules', degraded: true };
  }
}
