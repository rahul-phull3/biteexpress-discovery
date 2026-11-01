import type { ListQuery } from './list-query.schema';
import { defaultOrder, defaultSort, type ListSort, type SortOrder } from './list-sort';
import type { Vocabulary } from './vocabulary';

/** The point a listing measures distance from. */
export interface NearPoint {
  latitude: number;
  longitude: number;
  /** Only restaurants at most this many kilometres away. Absent: any distance. */
  radiusKm?: number;
}

/**
 * What a listing asks the store for: the validated query with city and cuisine
 * names as the data spells them, and every default decided. A key that was not
 * asked for is absent (never undefined), so a store can test with `!== undefined`
 * and a query builder can copy keys without writing nulls.
 */
export interface ListCriteria {
  /** Part of the name, any letter case. */
  nameContains?: string;
  /** Exact city name as stored. */
  city?: string;
  /** ISO 3166-1 alpha-2. */
  countryCode?: string;
  /** Exact cuisine names as stored. */
  cuisines?: string[];
  /** With several cuisines: a restaurant serving any of them, or all of them. */
  cuisineMatch: 'any' | 'all';
  /** At least this average rating. Unrated restaurants never match. */
  minRating?: number;
  /** Average cost for two, inclusive, in each restaurant's own currency. Unknown costs never match. */
  minCost?: number;
  maxCost?: number;
  /** ISO 4217 code of the restaurant's currency. */
  currency?: string;
  priceRange?: number;
  delivery?: boolean;
  booking?: boolean;
  near?: NearPoint;
  sort: ListSort;
  order: SortOrder;
  limit: number;
  offset: number;
}

/**
 * Turns a validated query string into criteria. This is where "Gurugram"
 * becomes "Gurgaon", "south indian" becomes "South Indian", and the sort and
 * its direction get their defaults.
 */
export function buildListCriteria(query: ListQuery, vocabulary: Vocabulary): ListCriteria {
  const hasPoint = query.lat !== undefined && query.lng !== undefined;
  const sort = query.sort ?? defaultSort(hasPoint);

  const criteria: ListCriteria = {
    cuisineMatch: query.cuisineMatch,
    sort,
    order: query.order ?? defaultOrder(sort),
    limit: query.limit,
    offset: query.offset,
  };
  if (query.name !== undefined) criteria.nameContains = query.name;
  if (query.city !== undefined) criteria.city = vocabulary.canonicalCity(query.city);
  if (query.country !== undefined) criteria.countryCode = query.country;
  if (query.cuisine !== undefined) {
    criteria.cuisines = [...new Set(query.cuisine.map((name) => vocabulary.canonicalCuisine(name)))];
  }
  if (query.minRating !== undefined) criteria.minRating = query.minRating;
  if (query.minCost !== undefined) criteria.minCost = query.minCost;
  if (query.maxCost !== undefined) criteria.maxCost = query.maxCost;
  if (query.currency !== undefined) criteria.currency = query.currency;
  if (query.priceRange !== undefined) criteria.priceRange = query.priceRange;
  if (query.delivery !== undefined) criteria.delivery = query.delivery;
  if (query.booking !== undefined) criteria.booking = query.booking;
  if (query.lat !== undefined && query.lng !== undefined) {
    criteria.near = { latitude: query.lat, longitude: query.lng };
    if (query.radiusKm !== undefined) criteria.near.radiusKm = query.radiusKm;
  }
  return criteria;
}
