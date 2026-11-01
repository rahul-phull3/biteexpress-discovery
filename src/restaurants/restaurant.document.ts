/**
 * A restaurant as it is stored in the `restaurants` collection (without _id).
 * The shape follows the $jsonSchema validator in database/restaurants.collection.ts:
 * the fields it requires are required here, the rest are optional.
 *
 * The importer writes the same shape; it adds tenantId and the timestamps in
 * the database layer (see importer/imported-restaurant.ts).
 */
export interface RestaurantDocument {
  tenantId: string;
  schemaVersion: 1;
  /** The identity in a legacy system. Absent for restaurants created only here. */
  source?: { system: string; id: string };
  name: string;
  address: {
    line: string | null;
    locality: string | null;
    city: string;
    country: { code: string; name: string };
  };
  /** GeoJSON order: [longitude, latitude]. Absent when the coordinates are unknown. */
  location?: { type: 'Point'; coordinates: [number, number] };
  cuisines: string[];
  cost?: {
    forTwo: number | null;
    currency: string;
    priceRange: number | null;
  };
  rating?: {
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
  /** Flags such as coords_missing and text_repaired. */
  dataQuality: string[];
  createdAt: Date;
  updatedAt: Date;
}
