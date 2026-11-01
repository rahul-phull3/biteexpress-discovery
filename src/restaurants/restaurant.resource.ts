import type { StoredRestaurant } from './restaurant.store';

/**
 * A restaurant as the API returns it: POST /v1/restaurants (the created
 * entity) and GET /v1/restaurants/{id} return exactly this.
 *
 * What differs from the stored document, and why:
 *  - `id` is the MongoDB _id as text; `tenantId` and `schemaVersion` stay inside.
 *  - `location` says latitude and longitude by name, so no client has to
 *    remember that GeoJSON puts longitude first.
 *  - Timestamps are ISO 8601 strings.
 * Fields are only ever added to this shape, never renamed or reinterpreted.
 */
export interface RestaurantResource {
  id: string;
  source?: { system: string; id: string };
  name: string;
  address: {
    line: string | null;
    locality: string | null;
    city: string;
    country: { code: string; name: string };
  };
  location?: { latitude: number; longitude: number };
  cuisines: string[];
  cost: { forTwo: number | null; currency: string | null; priceRange: number | null };
  rating: {
    average: number | null;
    votes: number;
    label: string | null;
    score: number | null;
  };
  services: {
    tableBooking: boolean;
    onlineDelivery: boolean;
    deliveringNow: boolean;
  };
  status: 'active' | 'inactive';
  dataQuality: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Maps a stored restaurant to its API shape. `cost` and `rating` are optional
 * in the database validator, so a document written by someone else without
 * them still maps, to nulls.
 */
export function toResource({ id, doc }: StoredRestaurant): RestaurantResource {
  const [longitude, latitude] = doc.location?.coordinates ?? [];
  return {
    id,
    ...(doc.source ? { source: { system: doc.source.system, id: doc.source.id } } : {}),
    name: doc.name,
    address: {
      line: doc.address.line,
      locality: doc.address.locality,
      city: doc.address.city,
      country: { code: doc.address.country.code, name: doc.address.country.name },
    },
    ...(longitude !== undefined && latitude !== undefined
      ? { location: { latitude, longitude } }
      : {}),
    cuisines: doc.cuisines,
    cost: {
      forTwo: doc.cost?.forTwo ?? null,
      currency: doc.cost?.currency ?? null,
      priceRange: doc.cost?.priceRange ?? null,
    },
    rating: {
      average: doc.rating?.average ?? null,
      votes: doc.rating?.votes ?? 0,
      label: doc.rating?.label ?? null,
      score: doc.rating?.score ?? null,
    },
    services: {
      tableBooking: doc.services.tableBooking,
      onlineDelivery: doc.services.onlineDelivery,
      deliveringNow: doc.services.deliveringNow,
    },
    status: doc.status,
    dataQuality: doc.dataQuality,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
