import { restaurantValidator } from '../database/restaurants.collection';
import { containsUndefined, schemaViolations } from '../../test/support/json-schema-lite';
import { buildRestaurantDocument } from './build-restaurant';
import { createRestaurantSchema } from './create-restaurant.schema';

const NOW = new Date('2026-11-01T10:30:00.000Z');

/** Runs a request body through the schema and the builder, the way the API does. */
function build(body: unknown, tenantId = 'tenant-a') {
  return buildRestaurantDocument(createRestaurantSchema.parse(body), { tenantId, now: NOW });
}

const minimal = { name: 'Naivedhyam', address: { city: 'Gurgaon', countryCode: 'IN' } };

const full = {
  name: 'Naivedhyam',
  address: { line: '12 Main Road', locality: 'Sector 29', city: 'Gurgaon', countryCode: 'IN' },
  location: { latitude: 28.4595, longitude: 77.0266 },
  cuisines: ['South Indian', 'Vegetarian'],
  cost: { forTwo: 800, priceRange: 2 },
  rating: { average: 4.3, votes: 4385 },
  services: { onlineDelivery: true },
  source: { system: 'zomato', id: '18123456' },
};

describe('buildRestaurantDocument', () => {
  it('fills in everything the client does not own', () => {
    expect(build(minimal)).toEqual({
      tenantId: 'tenant-a',
      schemaVersion: 1,
      name: 'Naivedhyam',
      address: {
        line: null,
        locality: null,
        city: 'Gurgaon',
        country: { code: 'IN', name: 'India' },
      },
      cuisines: [],
      cost: { forTwo: null, currency: 'INR', priceRange: null },
      rating: { average: null, votes: 0, label: null, score: null },
      services: { tableBooking: false, onlineDelivery: false, deliveringNow: false },
      status: 'active',
      dataQuality: ['coords_missing'],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('stores the location as GeoJSON, longitude first', () => {
    expect(build(full).location).toEqual({ type: 'Point', coordinates: [77.0266, 28.4595] });
  });

  it('does not flag a restaurant that has coordinates', () => {
    expect(build(full).dataQuality).toEqual([]);
  });

  it('derives the rating label and the weighted score from the average and the votes', () => {
    // 4385 / 4435 * 4.3 + 50 / 4435 * 3.44 = 4.2903 (the same formula as the importer)
    expect(build(full).rating).toEqual({ average: 4.3, votes: 4385, label: 'Very Good', score: 4.2903 });
  });

  it('keeps the votes of an unrated restaurant and gives it no label or score', () => {
    expect(build({ ...minimal, rating: { votes: 12 } }).rating).toEqual({
      average: null,
      votes: 12,
      label: null,
      score: null,
    });
  });

  it('takes the name and the currency of the country from the importer table', () => {
    const doc = build({ ...minimal, address: { city: 'London', countryCode: 'gb' } });

    expect(doc.address.country).toEqual({ code: 'GB', name: 'United Kingdom' });
    expect(doc.cost?.currency).toBe('GBP');
  });

  it('keeps the services the client set and defaults the others to false', () => {
    expect(build(full).services).toEqual({ tableBooking: false, onlineDelivery: true, deliveringNow: false });
  });

  it('copies the source identity', () => {
    expect(build(full).source).toEqual({ system: 'zomato', id: '18123456' });
    expect(build(minimal)).not.toHaveProperty('source');
  });

  it('drops a cuisine that repeats another in different letter case, keeping the first spelling', () => {
    expect(build({ ...minimal, cuisines: ['North Indian', 'north indian', 'Chinese', 'CHINESE'] }).cuisines).toEqual([
      'North Indian',
      'Chinese',
    ]);
  });

  it('stamps the tenant it is given and equal timestamps on creation', () => {
    const doc = build(minimal, 'acme');

    expect(doc.tenantId).toBe('acme');
    expect(doc.createdAt).toBe(NOW);
    expect(doc.updatedAt).toBe(NOW);
  });

  describe('what the database would say about the result', () => {
    // The unit-level version of the integration test: the same $jsonSchema the
    // collection enforces, applied to what this code builds.
    const bodies: Array<[string, unknown]> = [
      ['the smallest body', minimal],
      ['a full body', full],
      ['an unrated restaurant with votes', { ...minimal, rating: { votes: 12 } }],
      ['a restaurant abroad', { name: 'Joe', address: { city: 'New York', countryCode: 'US' }, location: { latitude: 40.7, longitude: -74 } }],
      ['a name of 200 characters', { ...minimal, name: 'n'.repeat(200) }],
      ['a whole-number average', { ...minimal, rating: { average: 4, votes: 1 } }],
    ];

    it.each(bodies)('accepts %s', (_label, body) => {
      expect(schemaViolations(restaurantValidator.$jsonSchema, build(body))).toEqual([]);
    });

    it.each(bodies)('contains no undefined, which the driver would store as null (%s)', (_label, body) => {
      expect(containsUndefined(build(body))).toBe(false);
    });
  });
});
