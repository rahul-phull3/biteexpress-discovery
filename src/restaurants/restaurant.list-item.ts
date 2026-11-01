import type { ListSort, SortOrder } from './list-sort';
import type { ListedRestaurant } from './restaurant.store';

/**
 * One restaurant in a listing: the attributes the brief asks for (id, name,
 * address, city, country, cuisines, average rating, distance where there is a
 * point) plus the few a restaurant card needs. The full restaurant is one
 * GET /v1/restaurants/{id} away. Fields are only ever added, never renamed.
 */
export interface RestaurantListItem {
  id: string;
  name: string;
  /** The street line; null when the restaurant has none. */
  address: string | null;
  locality: string | null;
  city: string;
  /** The country's name; `countryCode` is its ISO 3166-1 alpha-2 code. */
  country: string;
  countryCode: string;
  cuisines: string[];
  /** The plain average of the customers' ratings, 0 to 5; null for a restaurant nobody rated. */
  averageRating: number | null;
  votes: number;
  /** Average cost for two in `currency`; null when unknown. */
  costForTwo: number | null;
  currency: string | null;
  /** Kilometres from the lat/lng of the request, to 10 metres. Only present when the request had a point. */
  distanceKm?: number;
}

export interface RestaurantListResponse {
  data: RestaurantListItem[];
  page: { limit: number; offset: number; hasMore: boolean };
  /** The order that was applied (the default when the request named none) and how long the query took. */
  meta: { sort: ListSort; order: SortOrder; tookMs: number };
}

/** Maps a row of a listing to its API shape. `cost` and `rating` are optional in the database, so they map to nulls. */
export function toListItem({ id, doc, distanceKm }: ListedRestaurant): RestaurantListItem {
  return {
    id,
    name: doc.name,
    address: doc.address.line,
    locality: doc.address.locality,
    city: doc.address.city,
    country: doc.address.country.name,
    countryCode: doc.address.country.code,
    cuisines: doc.cuisines,
    averageRating: doc.rating?.average ?? null,
    votes: doc.rating?.votes ?? 0,
    costForTwo: doc.cost?.forTwo ?? null,
    currency: doc.cost?.currency ?? null,
    ...(distanceKm !== undefined ? { distanceKm } : {}),
  };
}
