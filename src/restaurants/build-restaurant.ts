import { weightedRatingScore } from '../importer/rating-score';
import type { CreateRestaurantInput } from './create-restaurant.schema';
import type { RestaurantDocument } from './restaurant.document';
import { ratingLabel } from './rating-label';
import { findCountryByIsoCode } from './supported-countries';

export interface BuildContext {
  tenantId: string;
  now: Date;
}

/**
 * Turns a validated request into the document that is stored. This is where
 * the server fills in everything the client does not own: the tenant, the
 * timestamps, the status, the currency (from the country), the rating label
 * and weighted score, and the data-quality flags. A pure function, so every
 * rule is tested without a database.
 *
 * The one place the coordinate order changes: the API says latitude and
 * longitude by name, GeoJSON stores [longitude, latitude].
 */
export function buildRestaurantDocument(
  input: CreateRestaurantInput,
  { tenantId, now }: BuildContext,
): RestaurantDocument {
  const country = findCountryByIsoCode(input.address.countryCode);
  if (!country) {
    // The schema already refused unknown codes; this keeps the types honest.
    throw new Error(`unsupported country code ${input.address.countryCode}`);
  }

  const average = input.rating?.average ?? null;
  const votes = input.rating?.votes ?? 0;
  const location: RestaurantDocument['location'] = input.location
    ? {
        type: 'Point',
        coordinates: [input.location.longitude, input.location.latitude],
      }
    : undefined;

  return {
    tenantId,
    schemaVersion: 1,
    ...(input.source
      ? { source: { system: input.source.system, id: input.source.id } }
      : {}),
    name: input.name,
    address: {
      line: input.address.line ?? null,
      locality: input.address.locality ?? null,
      city: input.address.city,
      country: { code: country.code, name: country.name },
    },
    ...(location ? { location } : {}),
    cuisines: distinctIgnoringCase(input.cuisines),
    cost: {
      forTwo: input.cost?.forTwo ?? null,
      currency: country.currency,
      priceRange: input.cost?.priceRange ?? null,
    },
    rating: {
      average,
      votes,
      label: average === null ? null : ratingLabel(average),
      score: average === null ? null : weightedRatingScore(average, votes),
    },
    services: {
      tableBooking: input.services?.tableBooking ?? false,
      onlineDelivery: input.services?.onlineDelivery ?? false,
      deliveringNow: input.services?.deliveringNow ?? false,
    },
    status: 'active',
    dataQuality: location ? [] : ['coords_missing'],
    createdAt: now,
    updatedAt: now,
  };
}

/** Drops a cuisine that repeats an earlier one in other letter case, keeping the first spelling. */
function distinctIgnoringCase(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}
