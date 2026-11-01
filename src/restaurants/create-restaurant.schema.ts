import { z } from 'zod';
import { INDIA_BOUNDS, NAME_MAX_LENGTH } from '../importer/clean-row';
import { collapseWhitespace } from '../importer/text';
import { findCountryByIsoCode, supportedCountryCodes } from './supported-countries';

/** Text with its whitespace collapsed (as the importer does), then 1 to `max` characters. */
const text = (max: number) =>
  z
    .string()
    .transform(collapseWhitespace)
    .pipe(
      z
        .string()
        .min(1, 'must not be empty')
        .max(max, `must be at most ${max} characters`),
    );

const countryCode = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(
    z
      .string()
      .refine(
        (code) => findCountryByIsoCode(code) !== undefined,
        `must be one of ${supportedCountryCodes().join(', ')}`,
      ),
  );

const location = z.strictObject({
  latitude: z
    .number()
    .min(-90, 'must be between -90 and 90')
    .max(90, 'must be between -90 and 90'),
  longitude: z
    .number()
    .min(-180, 'must be between -180 and 180')
    .max(180, 'must be between -180 and 180'),
});

const source = z.strictObject({
  system: z
    .string()
    .regex(
      /^[a-z][a-z0-9_-]{0,39}$/,
      'use 1 to 40 lowercase letters, digits, underscores or hyphens, starting with a letter',
    ),
  id: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, 'must not be empty')
        .max(100, 'must be at most 100 characters'),
    ),
});

/**
 * The body of POST /v1/restaurants. Every object is strict: a field this
 * contract does not name (tenantId, createdAt, rating.score, a typo) is an
 * error, never silently ignored, so a client cannot write a field it is not
 * meant to write.
 *
 * The server owns: the id, the tenant, the timestamps, the status, the
 * currency (from the country), the rating label and score (from the average
 * and the votes) and the data-quality flags.
 */
export const createRestaurantSchema = z
  .strictObject({
    name: text(NAME_MAX_LENGTH),
    address: z.strictObject({
      line: text(500).nullish(),
      locality: text(200).nullish(),
      city: text(100),
      countryCode,
    }),
    location: location.optional(),
    cuisines: z.array(text(60)).max(20, 'at most 20 cuisines').default([]),
    cost: z
      .strictObject({
        forTwo: z
          .number()
          .positive('must be greater than 0; omit it when the cost is unknown')
          .max(100_000_000, 'must be at most 100000000')
          .nullish(),
        priceRange: z
          .number()
          .int('must be a whole number')
          .min(1, 'must be 1 to 4')
          .max(4, 'must be 1 to 4')
          .nullish(),
      })
      .optional(),
    rating: z
      .strictObject({
        average: z
          .number()
          .gt(0, 'must be greater than 0; omit it for a restaurant nobody has rated')
          .max(5, 'must be at most 5')
          .nullish(),
        votes: z
          .number()
          .int('must be a whole number')
          .min(0, 'must be 0 or more')
          .max(1_000_000_000, 'must be at most 1000000000')
          .default(0),
      })
      .optional(),
    services: z
      .strictObject({
        tableBooking: z.boolean().default(false),
        onlineDelivery: z.boolean().default(false),
        deliveringNow: z.boolean().default(false),
      })
      .optional(),
    source: source.optional(),
  })
  .superRefine((value, context) => {
    const point = value.location;
    if (point) {
      if (point.latitude === 0 && point.longitude === 0) {
        context.addIssue({
          code: 'custom',
          path: ['location'],
          message:
            '0, 0 is not a real place (it is the default of a missing value). Leave location out when the coordinates are unknown.',
        });
      } else if (
        value.address.countryCode === 'IN' &&
        !isInsideIndia(point.latitude, point.longitude)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['location'],
          message:
            'These coordinates are outside India. Check that latitude and longitude are not swapped.',
        });
      }
    }

    // The dataset has no rated restaurant without votes, so an average with no
    // votes behind it is a mistake in the request.
    if (value.rating?.average != null && value.rating.votes < 1) {
      context.addIssue({
        code: 'custom',
        path: ['rating', 'votes'],
        message: 'must be at least 1 when an average rating is given',
      });
    }
  });

/** A validated request body: defaults applied, text tidied, country code upper-case. */
export type CreateRestaurantInput = z.output<typeof createRestaurantSchema>;

function isInsideIndia(latitude: number, longitude: number): boolean {
  return (
    latitude >= INDIA_BOUNDS.minLatitude &&
    latitude <= INDIA_BOUNDS.maxLatitude &&
    longitude >= INDIA_BOUNDS.minLongitude &&
    longitude <= INDIA_BOUNDS.maxLongitude
  );
}
