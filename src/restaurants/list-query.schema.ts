import { z } from 'zod';
import { collapseWhitespace } from '../importer/text';
import { LIST_SORTS, defaultSort } from './list-sort';
import { text } from './schema-fields';
import { findCountryByNameOrCode, supportedCountryCodes } from './supported-countries';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
/** Deep pages are expensive for the database, so the offset is bounded. */
export const MAX_OFFSET = 1000;
export const MAX_RADIUS_KM = 50;

// Every value arrives as text, so every field starts as z.string(). A value that
// is not text (an object from ?city[$ne]=x, or a list where one value is
// expected) fails right there, which is what keeps operator injection out.
//
// The format checks abort: Zod would otherwise carry on and turn "abc" into NaN,
// and report a second, confusing error about that.

const whole = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,9}$/, { error: 'must be a whole number', abort: true })
    .transform(Number)
    .pipe(
      z
        .number()
        .min(min, `must be between ${min} and ${max}`)
        .max(max, `must be between ${min} and ${max}`),
    );

const decimalText = z
  .string()
  .regex(/^-?\d{1,6}(\.\d{1,8})?$/, { error: 'must be a number such as 4.5', abort: true })
  .transform(Number);

const decimal = (min: number, max: number) =>
  decimalText.pipe(
    z
      .number()
      .min(min, `must be between ${min} and ${max}`)
      .max(max, `must be between ${min} and ${max}`),
  );

const flag = z
  .enum(['true', 'false'], { error: 'must be true or false' })
  .transform((value) => value === 'true');

/** ?cuisine=Thai&cuisine=Chinese and ?cuisine=Thai,Chinese both work; no cuisine name contains a comma. */
const cuisines = z
  .union([z.string(), z.array(z.string())], {
    error: 'must be a cuisine name, or several separated by commas',
  })
  .transform((value) => [
    ...new Set(
      [value]
        .flat()
        .flatMap((entry) => entry.split(','))
        .map(collapseWhitespace)
        .filter((entry) => entry !== ''),
    ),
  ])
  .pipe(
    z
      .array(z.string().max(60, 'each cuisine must be at most 60 characters'))
      .min(1, 'must name at least one cuisine')
      .max(20, 'at most 20 cuisines'),
  );

const country = text(60)
  .refine(
    (value) => findCountryByNameOrCode(value) !== undefined,
    `must be an ISO country code or a country name; the codes are ${supportedCountryCodes().join(', ')}`,
  )
  .transform((value) => findCountryByNameOrCode(value)?.code ?? value);

/**
 * The query string of GET /v1/restaurants (and of /search, which adds `q`).
 * Strict: a parameter that is not listed is a 400, so a typo is reported
 * instead of silently returning unfiltered results.
 */
export const listQuerySchema = z
  .strictObject({
    name: text(100).optional(),
    city: text(100).optional(),
    country: country.optional(),
    cuisine: cuisines.optional(),
    cuisineMatch: z.enum(['any', 'all'], { error: "must be 'any' or 'all'" }).default('any'),
    minRating: decimal(0, 5).optional(),
    minCost: whole(0, 100_000_000).optional(),
    maxCost: whole(0, 100_000_000).optional(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/, 'must be a 3-letter currency code such as INR')
      .transform((value) => value.toUpperCase())
      .optional(),
    priceRange: whole(1, 4).optional(),
    delivery: flag.optional(),
    booking: flag.optional(),
    lat: decimal(-90, 90).optional(),
    lng: decimal(-180, 180).optional(),
    radiusKm: decimalText
      .pipe(
        z
          .number()
          .gt(0, 'must be greater than 0')
          .max(MAX_RADIUS_KM, `must be at most ${MAX_RADIUS_KM}`),
      )
      .optional(),
    sort: z.enum(LIST_SORTS, { error: `must be one of ${LIST_SORTS.join(', ')}` }).optional(),
    order: z.enum(['asc', 'desc'], { error: "must be 'asc' or 'desc'" }).optional(),
    limit: whole(1, MAX_LIMIT).default(DEFAULT_LIMIT),
    offset: whole(0, MAX_OFFSET).default(0),
  })
  .superRefine((query, context) => {
    const problem = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });

    if (query.lat !== undefined && query.lng === undefined) {
      problem('lng', 'is required when lat is given');
    }
    if (query.lng !== undefined && query.lat === undefined) {
      problem('lat', 'is required when lng is given');
    }
    const hasPoint = query.lat !== undefined && query.lng !== undefined;
    if (query.radiusKm !== undefined && !hasPoint) {
      problem('radiusKm', 'needs lat and lng');
    }
    if (query.sort === 'distance' && !hasPoint) {
      problem('sort', 'distance needs lat and lng; there is nothing to measure from');
    }
    // Also catches the default: with a point and no sort, the sort is distance.
    if ((query.sort ?? defaultSort(hasPoint)) === 'distance' && query.order === 'desc') {
      problem('order', 'distance can only be sorted nearest first');
    }
    if (
      query.minCost !== undefined &&
      query.maxCost !== undefined &&
      query.minCost > query.maxCost
    ) {
      problem('minCost', 'must not be greater than maxCost');
    }
  });

/** A validated query string: numbers are numbers, flags are booleans, defaults applied. */
export type ListQuery = z.output<typeof listQuerySchema>;
