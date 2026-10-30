import { join } from 'node:path';
import {
  documentFromUpsert,
  schemaViolations,
} from '../../test/support/json-schema-lite';
import { restaurantValidator } from '../database/restaurants.collection';
import { cleanRow } from './clean-row';
import { importRestaurants } from './import-restaurants';
import type { ImportedRestaurant } from './imported-restaurant';
import { toUpsert } from './mongo-restaurant-sink';
import { hasNonAscii } from './text';
import {
  loadTextFixes,
  TEXT_FIELD_COLUMNS,
  TEXT_FIELDS,
  type TextFixes,
} from './text-fixes';
import { readZomatoCsv, type ZomatoRow } from './zomato-csv';

// The committed data files, cleaned for real. This is the check that the rules
// do what they should on data that has every problem the full file has: the
// numbers below were measured independently (a separate Python implementation
// of the same rules) and are the same ones the import report prints for the
// sample.

const SAMPLE = join(__dirname, '../../data/sample/zomato-sample.csv');
const FIXES = join(__dirname, '../../data/text-fixes.json');

/** "í" followed by a stray character: how the CSV damages é, í, á and friends. */
const DAMAGED_TEXT = /\u00ed[\u0080-\u00bf_]/;
const C1_CONTROL = /[\u0080-\u009f]/;

let rows: ZomatoRow[];
let fixes: TextFixes;
let restaurants: ImportedRestaurant[];

const byId = (id: string) => {
  const found = restaurants.find((restaurant) => restaurant.source.id === id);
  if (!found) throw new Error(`restaurant ${id} is not in the sample`);
  return found;
};

const texts = (restaurant: ImportedRestaurant) => [
  restaurant.name,
  restaurant.address.line ?? '',
  restaurant.address.locality ?? '',
  restaurant.address.city,
];

beforeAll(async () => {
  rows = await readZomatoCsv(SAMPLE);
  fixes = await loadTextFixes(FIXES);
  restaurants = rows.map((row) => {
    const result = cleanRow(row, fixes);
    if (!result.ok) throw new Error(`row ${result.sourceId}: ${result.reason}`);
    return result.restaurant;
  });
});

describe('the committed text fixes', () => {
  it('hold the 166 restaurants whose text is damaged in the full file', () => {
    expect(fixes.size).toBe(166);
  });

  it('never carry anything but the four text fields', () => {
    for (const fix of fixes.values()) {
      for (const key of Object.keys(fix)) {
        expect(TEXT_FIELDS).toContain(key);
      }
    }
  });

  it('replace text that has no damage left in it', () => {
    for (const fix of fixes.values()) {
      for (const text of Object.values(fix)) {
        expect(DAMAGED_TEXT.test(text)).toBe(false);
        expect(C1_CONTROL.test(text)).toBe(false);
        expect(text.includes('\ufffd')).toBe(false);
      }
    }
  });

  it('cover every row of the sample that has non-ASCII text, all of which is damaged', () => {
    const uncovered = rows
      .filter((row) =>
        TEXT_FIELDS.some((field) =>
          hasNonAscii(row[TEXT_FIELD_COLUMNS[field]]),
        ),
      )
      .filter((row) => !fixes.has(row['Restaurant ID'].trim()))
      .map((row) => row['Restaurant ID']);

    expect(uncovered).toEqual([]);
  });
});

describe('the committed sample', () => {
  it('has 500 rows with unique restaurant ids', () => {
    expect(rows).toHaveLength(500);
    expect(new Set(rows.map((row) => row['Restaurant ID'])).size).toBe(500);
  });

  it('is imported in full, with every number the independent implementation gives', async () => {
    const outcome = await importRestaurants(rows, fixes, { batchSize: 1000 });

    expect(outcome.rejected).toEqual([]);
    expect(outcome.stats).toEqual({
      rowsRead: 500,
      rowsAccepted: 500,
      rowsRejected: 0,
      textRepaired: 70,
      withLocation: 439,
      withoutLocation: 61,
      rated: 382,
      unrated: 118,
      costUnknown: 18,
      noCuisines: 9,
      distinctCuisines: 91,
      byCountry: {
        IN: 355,
        US: 30,
        BR: 24,
        TR: 20,
        AE: 10,
        QA: 8,
        ZA: 8,
        AU: 7,
        NZ: 7,
        GB: 6,
        SG: 6,
        ID: 5,
        LK: 5,
        PH: 5,
        CA: 4,
      },
    });
  });

  it('is cleaned the same way every time', async () => {
    const again = rows.map((row) => {
      const result = cleanRow(row, fixes);
      return result.ok ? result.restaurant : undefined;
    });

    expect(again).toEqual(restaurants);
  });
});

describe('the committed sample, once cleaned', () => {
  it('contains the damage the fixes were made for, before cleaning', () => {
    const damaged = rows.filter((row) =>
      TEXT_FIELDS.some((field) =>
        DAMAGED_TEXT.test(row[TEXT_FIELD_COLUMNS[field]]),
      ),
    );

    expect(damaged.length).toBeGreaterThan(40);
  });

  it('has no damaged text left', () => {
    const leftovers = restaurants.filter((restaurant) =>
      texts(restaurant).some(
        (text) =>
          DAMAGED_TEXT.test(text) ||
          C1_CONTROL.test(text) ||
          text.includes('\ufffd'),
      ),
    );

    expect(leftovers.map((restaurant) => restaurant.source.id)).toEqual([]);
  });

  it('has no stray whitespace or line breaks in any text', () => {
    const rawBreaks = rows.filter((row) => /[\r\n]/.test(row.Address));
    const untidy = restaurants.filter((restaurant) =>
      texts(restaurant).some(
        (text) => text !== text.replace(/\s+/g, ' ').trim(),
      ),
    );

    expect(rawBreaks.length).toBeGreaterThanOrEqual(6); // the sample keeps all six
    expect(untidy.map((restaurant) => restaurant.source.id)).toEqual([]);
  });

  it('has no repeated cuisine and no empty cuisine name', () => {
    const rawRepeats = rows.filter((row) => {
      const names = row.Cuisines.split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      return new Set(names).size !== names.length;
    });
    const bad = restaurants.filter(
      (restaurant) =>
        new Set(restaurant.cuisines).size !== restaurant.cuisines.length ||
        restaurant.cuisines.includes(''),
    );

    expect(rawRepeats.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it('puts every restaurant with a location inside the world, longitude first', () => {
    for (const { location } of restaurants) {
      if (!location) continue;
      const [longitude, latitude] = location.coordinates;
      expect(Math.abs(longitude)).toBeLessThanOrEqual(180);
      expect(Math.abs(latitude)).toBeLessThanOrEqual(90);
      expect(longitude).not.toBe(0);
      expect(latitude).not.toBe(0);
    }
  });

  it('keeps no Indian restaurant outside India', () => {
    for (const { address, location } of restaurants) {
      if (address.country.code !== 'IN' || !location) continue;
      const [longitude, latitude] = location.coordinates;
      expect(longitude).toBeGreaterThanOrEqual(68);
      expect(longitude).toBeLessThanOrEqual(98);
      expect(latitude).toBeGreaterThanOrEqual(6);
      expect(latitude).toBeLessThanOrEqual(37.5);
    }
  });

  it('flags every restaurant without a location, and only those', () => {
    for (const restaurant of restaurants) {
      expect(restaurant.dataQuality.includes('coords_missing')).toBe(
        restaurant.location === undefined,
      );
    }
  });

  it('gives a score to the rated restaurants and none to the others', () => {
    for (const { rating } of restaurants) {
      if (rating.average === null) {
        expect(rating.score).toBeNull();
        expect(rating.label).toBeNull();
      } else {
        expect(rating.score).not.toBeNull();
        expect(rating.average).toBeGreaterThan(0);
      }
    }
  });
});

describe('the committed sample, as the database would store it', () => {
  it('passes the collection validator, every restaurant', () => {
    const now = new Date('2026-10-30T12:00:00.000Z');

    const violations = restaurants.flatMap((restaurant) =>
      schemaViolations(
        restaurantValidator.$jsonSchema,
        documentFromUpsert(toUpsert(restaurant, 'biteexpress', now)),
      ).map((problem) => `${restaurant.source.id}: ${problem}`),
    );

    expect(violations).toEqual([]);
  });
});

describe('known restaurants in the sample', () => {
  it('Farzi Cafe is complete, with the score from the plan', () => {
    expect(byId('308022')).toEqual({
      schemaVersion: 1,
      source: { system: 'zomato', id: '308022' },
      name: 'Farzi Cafe',
      address: {
        line: '7-8, Ground Floor, Cyber Hub, DLF Cyber City, Gurgaon',
        locality: 'Cyber Hub, DLF Cyber City',
        city: 'Gurgaon',
        country: { code: 'IN', name: 'India' },
      },
      location: { type: 'Point', coordinates: [77.0886879, 28.4952079] },
      cuisines: ['Modern Indian'],
      cost: { forTwo: 2200, currency: 'INR', priceRange: 4 },
      rating: { average: 4.3, votes: 4385, label: 'Very Good', score: 4.2903 },
      services: {
        tableBooking: false,
        onlineDelivery: false,
        deliveringNow: false,
      },
      status: 'active',
      dataQuality: [],
    });
  });

  it('Rangrezz Restaurant in Agra is kept but has no location, because its coordinates were 0, 0', () => {
    const rangrezz = byId('3400341');

    expect(rangrezz.name).toBe('Rangrezz Restaurant');
    expect(rangrezz.address.city).toBe('Agra');
    expect('location' in rangrezz).toBe(false);
    expect(rangrezz.dataQuality).toEqual(['coords_missing']);
  });

  it('Café Daniel Briand in Brasília has its accents back', () => {
    const cafe = byId('6601005');

    expect(cafe.name).toBe('Café Daniel Briand');
    expect(cafe.address.city).toBe('Brasília');
    expect(cafe.address.line).toBe(
      'SCLN 104, Bloco A, Loja 26, Asa Norte, Brasília',
    );
    expect(cafe.dataQuality).toEqual(['text_repaired']);
    expect(cafe.cost.currency).toBe('BRL');
  });

  it('Sandubas Café has votes but no rating, so no score', () => {
    const sandubas = byId('6600060');

    expect(sandubas.name).toBe('Sandubas Café');
    expect(sandubas.rating).toEqual({
      average: null,
      votes: 2,
      label: null,
      score: null,
    });
  });
});
