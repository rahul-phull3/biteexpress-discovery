/** The system name stored in source.system for everything this importer writes. */
export const SOURCE_SYSTEM = 'zomato';

/**
 * Problems found while cleaning, kept next to the data so they stay visible
 * without polluting the real fields.
 * - coords_missing: the source coordinates were unusable, so there is no location.
 * - text_repaired: name, address, city or locality was replaced from text-fixes.json.
 */
export type DataQualityFlag = 'coords_missing' | 'text_repaired';

/**
 * A restaurant as the importer produces it: only the fields it owns. The
 * database layer adds tenantId, createdAt and updatedAt when it writes. The
 * shape follows the $jsonSchema validator in database/restaurants.collection.ts.
 *
 * Not imported on purpose: media and address.zipcode. They exist only in the
 * Zomato API dumps, which stay out of the repository (see data/README.md).
 */
export interface ImportedRestaurant {
  schemaVersion: 1;
  source: { system: typeof SOURCE_SYSTEM; id: string };
  name: string;
  address: {
    line: string | null;
    locality: string | null;
    city: string;
    country: { code: string; name: string };
  };
  /** Left out when the source coordinates are unusable. GeoJSON order: [longitude, latitude]. */
  location?: { type: 'Point'; coordinates: [number, number] };
  cuisines: string[];
  cost: { forTwo: number | null; currency: string; priceRange: number };
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
  status: 'active';
  dataQuality: DataQualityFlag[];
}
