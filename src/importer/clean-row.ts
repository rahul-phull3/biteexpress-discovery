import { findCountry } from './countries';
import {
  SOURCE_SYSTEM,
  type DataQualityFlag,
  type ImportedRestaurant,
} from './imported-restaurant';
import { weightedRatingScore } from './rating-score';
import { collapseWhitespace } from './text';
import { TEXT_FIELD_COLUMNS, TEXT_FIELDS, type TextFixes } from './text-fixes';
import type { ZomatoRow } from './zomato-csv';

/** Either the cleaned restaurant, or the reason this row cannot be imported. */
export type RowResult =
  | { ok: true; restaurant: ImportedRestaurant }
  | { ok: false; sourceId: string; reason: string };

/**
 * Rough bounding box of India, islands included. A coordinate outside it on an
 * Indian row is a placeholder, not a place: one test row sits at 35, 34.
 */
export const INDIA_BOUNDS = {
  minLatitude: 6,
  maxLatitude: 37.5,
  minLongitude: 68,
  maxLongitude: 98,
} as const;

/** The collection validator refuses longer names, so refuse them here with a clear reason. */
export const NAME_MAX_LENGTH = 200;

/** Thrown inside this file for a row that cannot be imported. cleanRow turns it into a result. */
class RowRejected extends Error {}

/**
 * Cleans one CSV row. The rules, in order:
 *  1. Take the corrected text from the fixes when the id is listed there.
 *  2. Collapse whitespace in name, address, city and locality.
 *  3. Keep the coordinates only when they are usable (see usableLocation).
 *  4. A rating of 0 means "Not rated" and a cost of 0 means "unknown": null.
 *  5. Country and currency come from the numeric country code.
 *  6. Split cuisines on commas, drop empties and repeats.
 *  7. Yes and No become booleans; the weighted score is computed.
 *
 * A row that breaks a hard rule (not a number where a number is required, an
 * unknown country, an empty name or city) is rejected, never half-imported.
 */
export function cleanRow(row: ZomatoRow, fixes: TextFixes): RowResult {
  const sourceId = row['Restaurant ID'].trim();
  try {
    return { ok: true, restaurant: buildRestaurant(row, sourceId, fixes) };
  } catch (error) {
    if (error instanceof RowRejected) {
      return { ok: false, sourceId, reason: error.message };
    }
    throw error;
  }
}

function buildRestaurant(
  row: ZomatoRow,
  sourceId: string,
  fixes: TextFixes,
): ImportedRestaurant {
  if (!/^\d+$/.test(sourceId)) {
    throw new RowRejected(`Restaurant ID "${sourceId}" is not a number`);
  }
  const country = findCountry(row['Country Code']);
  if (!country) {
    throw new RowRejected(`unknown Country Code "${row['Country Code']}"`);
  }

  const { text, repaired } = tidyText(row, sourceId, fixes);
  if (text.name === '') throw new RowRejected('the name is empty');
  if (text.name.length > NAME_MAX_LENGTH) {
    throw new RowRejected(
      `the name is longer than ${NAME_MAX_LENGTH} characters`,
    );
  }
  if (text.city === '') throw new RowRejected('the city is empty');

  const location = usableLocation(row.Longitude, row.Latitude, country.code);
  const average = parseDecimal(row['Aggregate rating'], 'Aggregate rating', 5);
  const votes = parseWhole(row.Votes, 'Votes');
  const costForTwo = parseWhole(
    row['Average Cost for two'],
    'Average Cost for two',
  );
  const priceRange = parseWhole(row['Price range'], 'Price range');
  if (priceRange < 1 || priceRange > 4) {
    throw new RowRejected(`Price range must be 1 to 4, got ${priceRange}`);
  }
  const rated = average > 0;

  const dataQuality: DataQualityFlag[] = [];
  if (!location) dataQuality.push('coords_missing');
  if (repaired) dataQuality.push('text_repaired');

  return {
    schemaVersion: 1,
    source: { system: SOURCE_SYSTEM, id: sourceId },
    name: text.name,
    address: {
      line: text.address || null,
      locality: text.locality || null,
      city: text.city,
      country: { code: country.code, name: country.name },
    },
    ...(location ? { location } : {}),
    cuisines: parseCuisines(row.Cuisines),
    cost: {
      forTwo: costForTwo > 0 ? costForTwo : null,
      currency: country.currency,
      priceRange,
    },
    rating: {
      average: rated ? average : null,
      votes,
      label: rated ? collapseWhitespace(row['Rating text']) || null : null,
      score: rated ? weightedRatingScore(average, votes) : null,
    },
    services: {
      tableBooking: parseYesNo(row['Has Table booking'], 'Has Table booking'),
      onlineDelivery: parseYesNo(
        row['Has Online delivery'],
        'Has Online delivery',
      ),
      deliveringNow: parseYesNo(row['Is delivering now'], 'Is delivering now'),
    },
    status: 'active',
    dataQuality,
  };
}

/** The four text fields, tidied, with the corrected text swapped in where the fixes have it. */
function tidyText(row: ZomatoRow, sourceId: string, fixes: TextFixes) {
  const fix = fixes.get(sourceId);
  const text = { name: '', address: '', city: '', locality: '' };
  let repaired = false;
  for (const field of TEXT_FIELDS) {
    const fromCsv = collapseWhitespace(row[TEXT_FIELD_COLUMNS[field]]);
    const replacement = fix?.[field];
    const value =
      replacement === undefined ? fromCsv : collapseWhitespace(replacement);
    if (value !== fromCsv) repaired = true;
    text[field] = value;
  }
  return { text, repaired };
}

/**
 * The point to store, or undefined when the coordinates cannot be trusted.
 * Real coordinates have six or seven decimals, so an exact 0 on either axis
 * is a placeholder (497 rows sit at 0,0, in the Gulf of Guinea). Also refused:
 * values that are not numbers, are out of range, or on an Indian row fall
 * outside India.
 */
function usableLocation(
  longitudeText: string,
  latitudeText: string,
  countryCode: string,
): ImportedRestaurant['location'] {
  const longitude = Number(longitudeText.trim());
  const latitude = Number(latitudeText.trim());
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return undefined;
  }
  if (longitude === 0 || latitude === 0) return undefined;
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return undefined;
  if (countryCode === 'IN' && !insideIndia(latitude, longitude)) {
    return undefined;
  }
  return { type: 'Point', coordinates: [longitude, latitude] };
}

function insideIndia(latitude: number, longitude: number): boolean {
  return (
    latitude >= INDIA_BOUNDS.minLatitude &&
    latitude <= INDIA_BOUNDS.maxLatitude &&
    longitude >= INDIA_BOUNDS.minLongitude &&
    longitude <= INDIA_BOUNDS.maxLongitude
  );
}

function parseCuisines(value: string): string[] {
  const names = value.split(',').map(collapseWhitespace);
  return [...new Set(names.filter((name) => name !== ''))];
}

function parseWhole(value: string, column: string): number {
  const text = value.trim();
  if (!/^\d+$/.test(text)) {
    throw new RowRejected(`${column} must be a whole number, got "${value}"`);
  }
  return Number(text);
}

function parseDecimal(value: string, column: string, max: number): number {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new RowRejected(`${column} must be a number, got "${value}"`);
  }
  const parsed = Number(text);
  if (parsed > max) {
    throw new RowRejected(`${column} must be at most ${max}, got ${parsed}`);
  }
  return parsed;
}

function parseYesNo(value: string, column: string): boolean {
  const text = value.trim();
  if (text === 'Yes') return true;
  if (text === 'No') return false;
  throw new RowRejected(`${column} must be "Yes" or "No", got "${value}"`);
}
