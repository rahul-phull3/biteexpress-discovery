import { zomatoRow } from '../../test/support/zomato-rows';
import { cleanRow, INDIA_BOUNDS, NAME_MAX_LENGTH } from './clean-row';
import type { ImportedRestaurant } from './imported-restaurant';
import type { TextFixes } from './text-fixes';
import type { ZomatoRow } from './zomato-csv';

const noFixes: TextFixes = new Map();

/** The cleaned restaurant of a row that must be accepted. */
function accepted(
  overrides: Partial<ZomatoRow> = {},
  fixes: TextFixes = noFixes,
): ImportedRestaurant {
  const result = cleanRow(zomatoRow(overrides), fixes);
  if (!result.ok) {
    throw new Error(`expected the row to be accepted, but: ${result.reason}`);
  }
  return result.restaurant;
}

/** The reason a row must be rejected. */
function rejection(overrides: Partial<ZomatoRow>): string {
  const result = cleanRow(zomatoRow(overrides), noFixes);
  if (result.ok) throw new Error('expected the row to be rejected');
  return result.reason;
}

describe('cleanRow', () => {
  it('maps a complete row to the document shape of the plan', () => {
    expect(accepted()).toEqual({
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

  it('produces only the fields the importer owns', () => {
    expect(Object.keys(accepted()).sort()).toEqual([
      'address',
      'cost',
      'cuisines',
      'dataQuality',
      'location',
      'name',
      'rating',
      'schemaVersion',
      'services',
      'source',
      'status',
    ]);
  });

  it('trims the restaurant id and keeps it as text', () => {
    expect(accepted({ 'Restaurant ID': ' 308022 ' }).source.id).toBe('308022');
  });

  it('reports the id of a row it rejects', () => {
    const result = cleanRow(zomatoRow({ 'Country Code': '999' }), noFixes);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.sourceId).toBe('308022');
  });

  it('does not change the row it is given', () => {
    const row = Object.freeze(
      zomatoRow({ 'Restaurant Name': ' Farzi  Cafe ', Cuisines: 'A, A, B' }),
    );
    const before = JSON.stringify(row);

    cleanRow(row, noFixes);

    expect(JSON.stringify(row)).toBe(before);
  });

  it('returns a new document every time, so nothing is shared between rows', () => {
    const first = accepted();
    const second = accepted();

    expect(first).toEqual(second);
    expect(first.cuisines).not.toBe(second.cuisines);
  });
});

describe('cleanRow: rows it refuses', () => {
  it('rejects a restaurant id that is not a number', () => {
    expect(rejection({ 'Restaurant ID': '12a' })).toContain('not a number');
    expect(rejection({ 'Restaurant ID': '' })).toContain('not a number');
    expect(rejection({ 'Restaurant ID': '-5' })).toContain('not a number');
  });

  it('rejects a country code that is not in the table', () => {
    expect(rejection({ 'Country Code': '999' })).toContain(
      'unknown Country Code "999"',
    );
    expect(rejection({ 'Country Code': '' })).toContain('unknown Country Code');
  });

  it('rejects an empty name, including one that is only spaces', () => {
    expect(rejection({ 'Restaurant Name': '' })).toContain('name is empty');
    expect(rejection({ 'Restaurant Name': ' \t ' })).toContain('name is empty');
  });

  it('rejects a name the collection validator would refuse for length', () => {
    expect(NAME_MAX_LENGTH).toBe(200);
    expect(rejection({ 'Restaurant Name': 'x'.repeat(201) })).toContain(
      'longer than 200',
    );
    expect(accepted({ 'Restaurant Name': 'x'.repeat(200) }).name).toHaveLength(
      200,
    );
  });

  it('rejects an empty city', () => {
    expect(rejection({ City: '  ' })).toContain('city is empty');
  });

  it('rejects a price range outside 1 to 4', () => {
    expect(rejection({ 'Price range': '0' })).toContain('1 to 4');
    expect(rejection({ 'Price range': '5' })).toContain('1 to 4');
    expect(rejection({ 'Price range': '' })).toContain('Price range');
    expect(rejection({ 'Price range': 'cheap' })).toContain('Price range');
    for (const range of ['1', '2', '3', '4']) {
      expect(accepted({ 'Price range': range }).cost.priceRange).toBe(
        Number(range),
      );
    }
  });
});

describe('cleanRow: text', () => {
  it('collapses whitespace in name, address, city and locality', () => {
    const restaurant = accepted({
      'Restaurant Name': '  Farzi   Cafe ',
      Address: 'Shop 4,\r\nCyber  Hub ',
      City: ' Gurgaon\t',
      Locality: 'Cyber   Hub',
    });

    expect(restaurant.name).toBe('Farzi Cafe');
    expect(restaurant.address.line).toBe('Shop 4, Cyber Hub');
    expect(restaurant.address.city).toBe('Gurgaon');
    expect(restaurant.address.locality).toBe('Cyber Hub');
  });

  it('stores an empty address or locality as null, not as an empty string', () => {
    const restaurant = accepted({ Address: ' ', Locality: '' });

    expect(restaurant.address.line).toBeNull();
    expect(restaurant.address.locality).toBeNull();
  });
});

describe('cleanRow: text fixes', () => {
  const damaged = {
    'Restaurant ID': '6601005',
    'Restaurant Name': 'Cafí© Daniel Briand',
    City: 'Brasí_lia',
    Address: 'SCLN 104, Asa Norte, Brasí_lia',
  } as const;

  it('replaces the fields a fix lists and flags the restaurant', () => {
    const fixes: TextFixes = new Map([
      [
        '6601005',
        {
          name: 'Café Daniel Briand',
          city: 'Brasília',
          address: 'SCLN 104, Asa Norte, Brasília',
        },
      ],
    ]);

    const restaurant = accepted(damaged, fixes);

    expect(restaurant.name).toBe('Café Daniel Briand');
    expect(restaurant.address.city).toBe('Brasília');
    expect(restaurant.address.line).toBe('SCLN 104, Asa Norte, Brasília');
    expect(restaurant.dataQuality).toEqual(['text_repaired']);
  });

  it('leaves the fields a fix does not list as they are', () => {
    const fixes: TextFixes = new Map([
      ['6601005', { name: 'Café Daniel Briand' }],
    ]);

    const restaurant = accepted(damaged, fixes);

    expect(restaurant.name).toBe('Café Daniel Briand');
    expect(restaurant.address.city).toBe('Brasí_lia');
  });

  it('collapses whitespace in the fixed text too', () => {
    const fixes: TextFixes = new Map([
      ['6601005', { name: '  Café   Daniel Briand ' }],
    ]);

    expect(accepted(damaged, fixes).name).toBe('Café Daniel Briand');
  });

  it('does not flag a fix whose text equals what the CSV already says', () => {
    const fixes: TextFixes = new Map([['308022', { name: 'Farzi Cafe' }]]);

    expect(accepted({}, fixes).dataQuality).toEqual([]);
  });

  it('ignores the fixes of other restaurants', () => {
    const fixes: TextFixes = new Map([['999', { name: 'Somebody Else' }]]);

    const restaurant = accepted({}, fixes);

    expect(restaurant.name).toBe('Farzi Cafe');
    expect(restaurant.dataQuality).toEqual([]);
  });

  it('repairs the locality as well', () => {
    const fixes: TextFixes = new Map([
      ['308022', { locality: 'Águas Claras' }],
    ]);

    expect(
      accepted({ Locality: 'í\u0081guas Claras' }, fixes).address.locality,
    ).toBe('Águas Claras');
  });
});

describe('cleanRow: location', () => {
  it('stores a GeoJSON point with longitude first', () => {
    const { location } = accepted({ Longitude: '77.5', Latitude: '28.25' });

    expect(location).toEqual({ type: 'Point', coordinates: [77.5, 28.25] });
  });

  it('leaves the location out, and says so, when either coordinate is exactly 0', () => {
    for (const coordinates of [
      { Longitude: '0', Latitude: '0' },
      { Longitude: '0', Latitude: '28.4952079' },
      { Longitude: '77.0886879', Latitude: '0' },
      { Longitude: '0.0', Latitude: '0.0' },
      { Longitude: '-0', Latitude: '28.4' },
    ]) {
      const restaurant = accepted(coordinates);

      expect('location' in restaurant).toBe(false);
      expect(restaurant.dataQuality).toEqual(['coords_missing']);
    }
  });

  it('leaves the location out when a coordinate is not a number', () => {
    for (const coordinates of [
      { Longitude: 'n/a', Latitude: '28.4' },
      { Longitude: '77.1', Latitude: '' },
      { Longitude: '', Latitude: '' },
      { Longitude: 'Infinity', Latitude: '28.4' },
    ]) {
      const restaurant = accepted(coordinates);

      expect('location' in restaurant).toBe(false);
      expect(restaurant.dataQuality).toEqual(['coords_missing']);
    }
  });

  it('leaves the location out when a coordinate is outside the valid range', () => {
    for (const coordinates of [
      { Longitude: '77.1', Latitude: '91' },
      { Longitude: '77.1', Latitude: '-91' },
      { Longitude: '181', Latitude: '28.4' },
      { Longitude: '-181', Latitude: '28.4' },
    ]) {
      expect('location' in accepted(coordinates)).toBe(false);
    }
  });

  it('refuses an Indian restaurant that sits outside India, such as the test row at 34, 35', () => {
    const restaurant = accepted({ Longitude: '34', Latitude: '35' });

    expect('location' in restaurant).toBe(false);
    expect(restaurant.dataQuality).toEqual(['coords_missing']);
  });

  it('uses the box from the plan: latitude 6 to 37.5, longitude 68 to 98', () => {
    // Written out in full on purpose. The next test follows whatever the constant says.
    expect(INDIA_BOUNDS).toEqual({
      minLatitude: 6,
      maxLatitude: 37.5,
      minLongitude: 68,
      maxLongitude: 98,
    });
  });

  it('accepts the edges of the India box and refuses just beyond them', () => {
    const { minLatitude, maxLatitude, minLongitude, maxLongitude } =
      INDIA_BOUNDS;
    const at = (longitude: number, latitude: number) =>
      'location' in
      accepted({ Longitude: String(longitude), Latitude: String(latitude) });

    expect(at(minLongitude, minLatitude)).toBe(true);
    expect(at(maxLongitude, maxLatitude)).toBe(true);
    expect(at(minLongitude - 0.0001, 20)).toBe(false);
    expect(at(maxLongitude + 0.0001, 20)).toBe(false);
    expect(at(80, minLatitude - 0.0001)).toBe(false);
    expect(at(80, maxLatitude + 0.0001)).toBe(false);
  });

  it('applies the India box by country, not by position', () => {
    // A San Francisco point on an Indian row is wrong; the same point on a US row is right.
    const india = accepted({ Longitude: '-122.4194', Latitude: '37.7749' });
    const usa = accepted({
      'Country Code': '216',
      Longitude: '-122.4194',
      Latitude: '37.7749',
    });

    expect('location' in india).toBe(false);
    expect(usa.location).toEqual({
      type: 'Point',
      coordinates: [-122.4194, 37.7749],
    });
  });

  it('keeps an Indian-looking point on a non-Indian row: only India has the box', () => {
    const restaurant = accepted({
      'Country Code': '208',
      Longitude: '29',
      Latitude: '41',
    });

    expect(restaurant.location).toEqual({
      type: 'Point',
      coordinates: [29, 41],
    });
  });
});

describe('cleanRow: rating', () => {
  it('computes the weighted score of a rated restaurant', () => {
    expect(accepted().rating).toEqual({
      average: 4.3,
      votes: 4385,
      label: 'Very Good',
      score: 4.2903,
    });
  });

  it('treats a rating of 0 as "not rated": no average, label or score', () => {
    for (const zero of ['0', '0.0', '0.00']) {
      expect(
        accepted({
          'Aggregate rating': zero,
          'Rating text': 'Not rated',
          Votes: '12',
        }).rating,
      ).toEqual({ average: null, votes: 12, label: null, score: null });
    }
  });

  it('keeps no label for a rated restaurant whose rating text is empty', () => {
    expect(accepted({ 'Rating text': '  ' }).rating.label).toBeNull();
  });

  it('tidies the label', () => {
    expect(accepted({ 'Rating text': '  Very   Good ' }).rating.label).toBe(
      'Very Good',
    );
  });

  it('rejects a rating that is not a number between 0 and 5', () => {
    expect(rejection({ 'Aggregate rating': '5.1' })).toContain('at most 5');
    expect(rejection({ 'Aggregate rating': '-1' })).toContain(
      'Aggregate rating',
    );
    expect(rejection({ 'Aggregate rating': '4,3' })).toContain(
      'Aggregate rating',
    );
    expect(rejection({ 'Aggregate rating': 'abc' })).toContain(
      'Aggregate rating',
    );
    expect(rejection({ 'Aggregate rating': '' })).toContain('Aggregate rating');
    expect(accepted({ 'Aggregate rating': '5' }).rating.average).toBe(5);
    expect(accepted({ 'Aggregate rating': '5.0' }).rating.average).toBe(5);
  });

  it('rejects votes that are not a whole number', () => {
    for (const votes of ['1,234', '', '-5', '12.5', 'many']) {
      expect(rejection({ Votes: votes })).toContain(
        'Votes must be a whole number',
      );
    }
  });
});

describe('cleanRow: cost', () => {
  it('keeps a positive cost for two', () => {
    expect(accepted({ 'Average Cost for two': '450' }).cost.forTwo).toBe(450);
  });

  it('treats a cost of 0 as unknown', () => {
    expect(accepted({ 'Average Cost for two': '0' }).cost.forTwo).toBeNull();
  });

  it('rejects a cost that is not a whole number', () => {
    expect(rejection({ 'Average Cost for two': 'free' })).toContain(
      'Average Cost for two',
    );
    expect(rejection({ 'Average Cost for two': '' })).toContain(
      'Average Cost for two',
    );
  });

  it('takes the currency from the country, whatever the CSV says', () => {
    expect(accepted({ 'Country Code': '216' }).cost.currency).toBe('USD');
    expect(accepted({ 'Country Code': '162' }).cost.currency).toBe('PHP');
    expect(accepted({ 'Country Code': '215' }).cost.currency).toBe('GBP');
    expect(accepted().cost.currency).toBe('INR');
  });

  it('takes the country name and ISO code from the country code', () => {
    expect(accepted({ 'Country Code': '214' }).address.country).toEqual({
      code: 'AE',
      name: 'United Arab Emirates',
    });
  });
});

describe('cleanRow: cuisines', () => {
  it('splits on commas and tidies each name', () => {
    expect(
      accepted({ Cuisines: 'North Indian,  Mughlai ,Chinese' }).cuisines,
    ).toEqual(['North Indian', 'Mughlai', 'Chinese']);
  });

  it('collapses whitespace inside a name', () => {
    expect(accepted({ Cuisines: 'North   Indian' }).cuisines).toEqual([
      'North Indian',
    ]);
  });

  it('gives an empty list for a row with no cuisines', () => {
    expect(accepted({ Cuisines: '' }).cuisines).toEqual([]);
    expect(accepted({ Cuisines: ' , ,' }).cuisines).toEqual([]);
  });

  it('drops repeated cuisines and keeps the first occurrence in place', () => {
    expect(
      accepted({ Cuisines: 'Pizza, Italian, Pizza, Cafe, Italian' }).cuisines,
    ).toEqual(['Pizza', 'Italian', 'Cafe']);
  });

  it('keeps names that differ only in case, as the source spells them', () => {
    expect(accepted({ Cuisines: 'Cafe, cafe' }).cuisines).toEqual([
      'Cafe',
      'cafe',
    ]);
  });
});

describe('cleanRow: services', () => {
  it('turns Yes and No into booleans', () => {
    const restaurant = accepted({
      'Has Table booking': 'Yes',
      'Has Online delivery': 'No',
      'Is delivering now': 'Yes',
    });

    expect(restaurant.services).toEqual({
      tableBooking: true,
      onlineDelivery: false,
      deliveringNow: true,
    });
  });

  it('rejects anything else, naming the column', () => {
    expect(rejection({ 'Has Table booking': 'yes' })).toContain(
      'Has Table booking must be "Yes" or "No"',
    );
    expect(rejection({ 'Has Online delivery': '' })).toContain(
      'Has Online delivery',
    );
    expect(rejection({ 'Is delivering now': '1' })).toContain(
      'Is delivering now',
    );
  });
});

describe('cleanRow: data quality flags', () => {
  it('has none for a clean row', () => {
    expect(accepted().dataQuality).toEqual([]);
  });

  it('lists coords_missing before text_repaired when both apply', () => {
    const fixes: TextFixes = new Map([['308022', { name: 'Farzi Café' }]]);

    const restaurant = accepted({ Latitude: '0', Longitude: '0' }, fixes);

    expect(restaurant.dataQuality).toEqual(['coords_missing', 'text_repaired']);
  });
});
