import type { Document } from 'mongodb';
import { SEARCH_INDEX_NAME } from '../database/restaurants.collection';

/**
 * The Atlas Search query for the leftover words of a sentence. A pure function,
 * so every rule of it is unit tested (atlas-text-query.spec.ts) without a
 * database; test/atlas-text-search.int-spec.ts runs it against a real one.
 *
 * Why it only returns ids: $search and $geoNear must each be the first stage of
 * a pipeline, so one query cannot both search the words and measure distance.
 * The search therefore asks Atlas for the matching restaurant ids first, and the
 * ordinary listing query then runs on just those ids (an `_id` filter), with the
 * city, the price and the sort, "nearest first" included.
 */

/**
 * How many restaurants Atlas may name for one set of words. The best matches come
 * first. A set of words that more restaurants than this fit is too vague to be a
 * useful search, and the listing query stays cheap with at most this many ids.
 */
export const TEXT_SEARCH_CANDIDATE_LIMIT = 500;

/** From this many letters a word may contain one typo ("vadda" finds "vada"); a shorter word must be exact. */
export const FUZZY_MIN_LENGTH = 4;

/**
 * One word, which must fit the name or the area (the locality), in any of three
 * ways: as a whole word (with one typo, for a word of four letters or more), or as
 * the beginning of a longer word ("pa" finds "pav"), in the name or in the area.
 * Every field and index type named here is in restaurantsSearchDefinition, and a
 * test keeps the two together.
 */
function wordClause(word: string): Document {
  const typo = word.length >= FUZZY_MIN_LENGTH ? { fuzzy: { maxEdits: 1, prefixLength: 1 } } : {};
  return {
    compound: {
      should: [
        { text: { query: word, path: ['name', 'address.locality'], ...typo } },
        { autocomplete: { query: word, path: 'name' } },
        { autocomplete: { query: word, path: 'address.locality' } },
      ],
      minimumShouldMatch: 1,
    },
  };
}

/**
 * Names the tenant's active restaurants that fit every word, best match first.
 * The tenant and the status are filters of the search itself, so another
 * tenant's restaurant or an inactive one is never named.
 */
export function buildTextSearchPipeline(
  tenantId: string,
  words: readonly string[],
  limit: number = TEXT_SEARCH_CANDIDATE_LIMIT,
): Document[] {
  return [
    {
      $search: {
        index: SEARCH_INDEX_NAME,
        compound: {
          filter: [
            { equals: { path: 'tenantId', value: tenantId } },
            { equals: { path: 'status', value: 'active' } },
          ],
          must: words.map(wordClause),
        },
      },
    },
    { $limit: limit },
    { $project: { _id: 1 } },
  ];
}
