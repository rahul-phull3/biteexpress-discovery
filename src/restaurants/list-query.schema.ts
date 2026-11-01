import { z } from 'zod';
import { collapseWhitespace } from '../importer/text';
import { LIST_SORTS, defaultSort, type ListSort, type SortOrder } from './list-sort';
import { text } from './schema-fields';
import { findCountryByNameOrCode, supportedCountryCodes } from './supported-countries';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
/** Deep pages are expensive for the database, so the offset is bounded. */
export const MAX_OFFSET = 1000;
export const MAX_RADIUS_KM = 50;
/** The most a cost filter accepts. */
export const MAX_COST = 100_000_000;
/** The longest sentence the search reads. */
export const MAX_SEARCH_TEXT = 200;

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
 * The parameters of GET /v1/restaurants, apart from the two that paging adds.
 * GET /v1/restaurants/search takes the same ones (and `q`), so they are written
 * once. Strict objects below: a parameter that is not listed is a 400, so a typo
 * is reported instead of silently returning unfiltered results.
 */
const listFields = {
  name: text(100).optional(),
  city: text(100).optional(),
  country: country.optional(),
  cuisine: cuisines.optional(),
  cuisineMatch: z.enum(['any', 'all'], { error: "must be 'any' or 'all'" }).default('any'),
  minRating: decimal(0, 5).optional(),
  minCost: whole(0, MAX_COST).optional(),
  maxCost: whole(0, MAX_COST).optional(),
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
};

const limit = whole(1, MAX_LIMIT);
const offset = whole(0, MAX_OFFSET);

/** The parts of a query that the rules between parameters look at. */
export interface CrossCheckedQuery {
  lat?: number | undefined;
  lng?: number | undefined;
  radiusKm?: number | undefined;
  sort?: ListSort | undefined;
  order?: SortOrder | undefined;
  minCost?: number | undefined;
  maxCost?: number | undefined;
}

export interface QueryProblem {
  /** The parameter the problem is about. */
  path: string;
  message: string;
}

/**
 * The rules that involve more than one parameter. The schemas apply them to
 * what a request sent; the search applies them again to what the request sent
 * together with what its sentence meant.
 */
export function listQueryProblems(query: CrossCheckedQuery): QueryProblem[] {
  const problems: QueryProblem[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });

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
  if (query.minCost !== undefined && query.maxCost !== undefined && query.minCost > query.maxCost) {
    problem('minCost', 'must not be greater than maxCost');
  }
  return problems;
}

/** The query string of GET /v1/restaurants. */
export const listQuerySchema = z
  .strictObject({
    ...listFields,
    limit: limit.default(DEFAULT_LIMIT),
    offset: offset.default(0),
  })
  .superRefine((query, context) => {
    for (const { path, message } of listQueryProblems(query)) {
      context.addIssue({ code: 'custom', path: [path], message });
    }
  });

/** A validated query string: numbers are numbers, flags are booleans, defaults applied. */
export type ListQuery = z.output<typeof listQuerySchema>;

/**
 * The query string of GET /v1/restaurants/search: everything the list takes,
 * and `q`, a sentence such as "best pizza in Gurgaon under Rs. 1000 for two".
 * `limit` has no default here, because the sentence may set it ("top 5") and an
 * explicit limit must be told apart from none.
 */
export const searchQuerySchema = z
  .strictObject({
    ...listFields,
    limit: limit.optional(),
    offset: offset.default(0),
    q: text(MAX_SEARCH_TEXT).optional(),
  })
  .superRefine((query, context) => {
    for (const { path, message } of listQueryProblems(query)) {
      // With a point and no sort, the list sorts by distance, and distance cannot be reversed.
      // Here the sentence may still ask for another sort ("best ..."), so the search decides
      // that one once it has read the sentence (see mergeSearch).
      if (path === 'order' && query.sort === undefined) continue;
      context.addIssue({ code: 'custom', path: [path], message });
    }
  });

/** A validated search query string. */
export type SearchQuery = z.output<typeof searchQuerySchema>;
