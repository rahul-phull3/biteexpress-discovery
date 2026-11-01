/**
 * The orders a listing can be sorted by.
 *
 *   distance       nearest first; needs a point to measure from
 *   rating         the weighted score, best first (what the API calls "best")
 *   averageRating  the plain average the customers gave, ties broken by votes
 *   votes          most reviewed first
 *   cost           cheapest first (average cost for two)
 *   name           A to Z
 *   city           A to Z, best first inside each city
 */
export const LIST_SORTS = [
  'distance',
  'rating',
  'averageRating',
  'votes',
  'cost',
  'name',
  'city',
] as const;
export type ListSort = (typeof LIST_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

/** The direction a person means when they name a sort and nothing else. */
const DEFAULT_ORDER: Readonly<Record<ListSort, SortOrder>> = {
  distance: 'asc',
  rating: 'desc',
  averageRating: 'desc',
  votes: 'desc',
  cost: 'asc',
  name: 'asc',
  city: 'asc',
};

export function defaultOrder(sort: ListSort): SortOrder {
  return DEFAULT_ORDER[sort];
}

/** Nearest first when the request gives a point to measure from, otherwise best first. */
export function defaultSort(hasPoint: boolean): ListSort {
  return hasPoint ? 'distance' : 'rating';
}
