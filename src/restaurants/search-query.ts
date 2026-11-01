import { validationProblem } from '../http/problem';
import type { ListCriteria } from './list-criteria';
import {
  DEFAULT_LIMIT,
  listQueryProblems,
  type ListQuery,
  type SearchQuery,
} from './list-query.schema';
import type { ParsedSearch, SearchFilters } from './search-text';
import { findCountryByIsoCode } from './supported-countries';

/**
 * What a search request means once its sentence has been read: the list query
 * to run, and a record of what came from where.
 */
export interface MergedSearch {
  /** The sentence as it was read; null when the request had none. */
  q: string | null;
  /** What the request sent, filled in from the sentence wherever the request said nothing. */
  query: ListQuery;
  /** The part of `query` that came from the sentence. */
  fromText: SearchFilters;
  /** Parameters the request sent itself, which replaced what the sentence said. */
  overridden: string[];
  /** Words that must each appear in a restaurant's name or area. */
  words: string[];
  notes: string[];
}

/** Parameters that a request can send and a sentence can set, which are replaced one by one. */
const REPLACEABLE = ['city', 'country', 'cuisine', 'minRating', 'currency', 'delivery', 'booking', 'radiusKm', 'limit'] as const;

/**
 * Puts a request and the meaning of its sentence together.
 *
 *  - A parameter the request sent wins over the sentence, one by one: "pizza in
 *    Delhi" with `city=Pune` is pizza in Pune. A sentence is a convenience; a
 *    parameter is an instruction.
 *  - A price is one idea, so `minCost` or `maxCost` in the request replaces the
 *    sentence's whole price, not just the bound it names. The sort and its
 *    direction are likewise taken or replaced together.
 *  - The name filter is not replaced: it and the sentence's words both apply.
 *  - Distance needs a place to measure from. The sentence never supplies one, so
 *    without `lat` and `lng` its "nearest", its radius and its "near me" are left out,
 *    with a note.
 *
 * Throws a 400 when the result breaks a rule between parameters, which can only
 * happen when the request contradicts its own sentence (`order=desc` with "nearest").
 */
export function mergeSearch(request: SearchQuery, parsed: ParsedSearch): MergedSearch {
  const { q, limit, ...parameters } = request;
  const text: SearchFilters = { ...parsed.filters };
  const overridden: string[] = [];
  const hasPoint = request.lat !== undefined && request.lng !== undefined;

  let notes = [...parsed.notes];

  if (!hasPoint) {
    if (text.sort === 'distance' || text.radiusKm !== undefined || parsed.locationWanted) {
      notes.push('The text asks for something near you, but the request has no lat and lng, so distance was not used.');
    }
    if (text.sort === 'distance') delete text.sort;
    delete text.radiusKm;
    // What the notes said about the radius no longer applies.
    notes = notes.filter((note) => !parsed.radiusNotes.includes(note));
  }

  if (request.minCost !== undefined || request.maxCost !== undefined) {
    for (const key of ['minCost', 'maxCost', 'currency'] as const) {
      if (text[key] === undefined) continue;
      overridden.push(key);
      delete text[key];
    }
    // What the notes said about the sentence's price no longer applies.
    notes = notes.filter((note) => !parsed.priceNotes.includes(note));
  }

  for (const key of REPLACEABLE) {
    if (request[key] === undefined || text[key] === undefined) continue;
    overridden.push(key);
    delete text[key];
  }
  if (overridden.includes('radiusKm')) notes = notes.filter((note) => !parsed.radiusNotes.includes(note));
  if (request.sort !== undefined && text.sort !== undefined) {
    overridden.push('sort');
    delete text.sort;
    // The direction that belonged to the sentence's sort goes with it.
    delete text.order;
  }
  if (request.order !== undefined && text.order !== undefined) {
    overridden.push('order');
    delete text.order;
  }
  if (overridden.length > 0) {
    notes.push(
      `The request also sent ${overridden.join(', ')}, so ${overridden.length === 1 ? 'that was' : 'those were'} used instead of the text's.`,
    );
  }

  const query: ListQuery = { ...parameters, ...text, limit: limit ?? text.limit ?? DEFAULT_LIMIT };
  const problems = listQueryProblems(query);
  if (problems.length > 0) {
    throw validationProblem(
      problems.map(({ path, message }) => ({ parameter: path, detail: message })),
      'The request does not fit the sentence it came with. See errors for each parameter.',
    );
  }

  return { q: q ?? null, query, fromText: text, overridden, words: parsed.words, notes };
}

const ORDER_IN_WORDS: Record<string, string> = {
  'distance:asc': 'nearest first',
  'rating:desc': 'best rated first',
  'rating:asc': 'lowest rated first',
  'averageRating:desc': 'highest average rating first',
  'averageRating:asc': 'lowest average rating first',
  'votes:desc': 'most reviewed first',
  'votes:asc': 'least reviewed first',
  'cost:asc': 'cheapest first',
  'cost:desc': 'most expensive first',
  'name:asc': 'A to Z',
  'name:desc': 'Z to A',
  'city:asc': 'by city, A to Z',
  'city:desc': 'by city, Z to A',
};

function costInWords(criteria: ListCriteria): string | undefined {
  const { minCost, maxCost, currency } = criteria;
  const unit = currency === undefined ? '' : ` ${currency}`;
  if (minCost !== undefined && maxCost !== undefined) return `between ${minCost} and ${maxCost}${unit}`;
  if (maxCost !== undefined) return `at most ${maxCost}${unit}`;
  if (minCost !== undefined) return `at least ${minCost}${unit}`;
  return undefined;
}

/**
 * The whole search in one line, built from the criteria that will run, so it
 * cannot disagree with them: "South Indian restaurants in Gurgaon, best rated first".
 */
export function summarizeSearch(criteria: ListCriteria): string {
  const kind = criteria.cuisines?.length
    ? `${criteria.cuisines.join(criteria.cuisineMatch === 'all' ? ' and ' : ' or ')} restaurants`
    : 'Restaurants';
  const country = criteria.countryCode === undefined ? undefined : (findCountryByIsoCode(criteria.countryCode)?.name ?? criteria.countryCode);
  let head = kind;
  if (criteria.city !== undefined) head += ` in ${criteria.city}${country === undefined ? '' : ` (${country})`}`;
  else if (country !== undefined) head += ` in ${country}`;

  // "Restaurants in Gurgaon with "vada pav" in the name or area": the words belong to the sentence's subject.
  const containing: string[] = [];
  if (criteria.nameContains !== undefined) containing.push(`"${criteria.nameContains}" in the name`);
  if (criteria.textWords !== undefined && criteria.textWords.length > 0) {
    containing.push(`"${criteria.textWords.join(' ')}" in the name or area`);
  }
  if (containing.length > 0) head += ` with ${containing.join(' and ')}`;

  const clauses: string[] = [];
  const cost = costInWords(criteria);
  if (cost !== undefined) clauses.push(`average cost for two ${cost}`);
  if (criteria.priceRange !== undefined) clauses.push(`price range ${criteria.priceRange}`);
  if (criteria.minRating !== undefined) clauses.push(`rated ${criteria.minRating} or more`);
  if (criteria.delivery !== undefined) clauses.push(criteria.delivery ? 'with online delivery' : 'without online delivery');
  if (criteria.booking !== undefined) clauses.push(criteria.booking ? 'with table booking' : 'without table booking');
  if (criteria.near?.radiusKm !== undefined) clauses.push(`within ${criteria.near.radiusKm} km`);
  clauses.push(ORDER_IN_WORDS[`${criteria.sort}:${criteria.order}`] ?? `by ${criteria.sort}`);
  return [head, ...clauses].join(', ');
}
