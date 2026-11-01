import type { RestaurantListResponse } from './restaurant.list-item';
import type { SearchFilters } from './search-text';

/** How the search read the request: what it understood, so that a surprising result can be explained. */
export interface SearchInterpretation {
  /** The sentence as it was read (whitespace tidied); null when the request had none. */
  q: string | null;
  /** The whole search in one line: what the text and the parameters asked for together. */
  summary: string;
  /**
   * The parameters of GET /v1/restaurants that the text turned into and that
   * were used. Send them yourself to get the same list without the sentence.
   */
  filters: SearchFilters;
  /** Words that are none of the above. Each one must appear in a restaurant's name or area. */
  words: string[];
  /** Parameters the request sent itself, and which therefore replaced what the text said. */
  overridden: string[];
  /** What was assumed, ignored or cannot be answered, in plain words. */
  notes: string[];
}

/** The answer of GET /v1/restaurants/search: a listing, and how its sentence was read. */
export interface RestaurantSearchResponse extends RestaurantListResponse {
  interpretation: SearchInterpretation;
}
