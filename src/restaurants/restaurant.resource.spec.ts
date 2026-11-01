import { buildRestaurantDocument } from './build-restaurant';
import { createRestaurantSchema } from './create-restaurant.schema';
import { toResource } from './restaurant.resource';

const NOW = new Date('2026-11-01T10:30:00.000Z');
const ID = '507f1f77bcf86cd799439011';

function resourceFor(body: unknown) {
  const doc = buildRestaurantDocument(createRestaurantSchema.parse(body), { tenantId: 'tenant-a', now: NOW });
  return toResource({ id: ID, doc });
}

describe('toResource', () => {
  const body = {
    name: 'Naivedhyam',
    address: { line: '12 Main Road', locality: 'Sector 29', city: 'Gurgaon', countryCode: 'IN' },
    location: { latitude: 28.4595, longitude: 77.0266 },
    cuisines: ['South Indian'],
    cost: { forTwo: 800, priceRange: 2 },
    rating: { average: 4.3, votes: 4385 },
    source: { system: 'zomato', id: '18123456' },
  };

  it('returns the public shape of a restaurant', () => {
    expect(resourceFor(body)).toEqual({
      id: ID,
      source: { system: 'zomato', id: '18123456' },
      name: 'Naivedhyam',
      address: {
        line: '12 Main Road',
        locality: 'Sector 29',
        city: 'Gurgaon',
        country: { code: 'IN', name: 'India' },
      },
      location: { latitude: 28.4595, longitude: 77.0266 },
      cuisines: ['South Indian'],
      cost: { forTwo: 800, currency: 'INR', priceRange: 2 },
      rating: { average: 4.3, votes: 4385, label: 'Very Good', score: 4.2903 },
      services: { tableBooking: false, onlineDelivery: false, deliveringNow: false },
      status: 'active',
      dataQuality: [],
      createdAt: '2026-11-01T10:30:00.000Z',
      updatedAt: '2026-11-01T10:30:00.000Z',
    });
  });

  it('keeps the internals inside: no tenant, no schema version, no _id', () => {
    const keys = Object.keys(resourceFor(body));

    expect(keys).not.toContain('tenantId');
    expect(keys).not.toContain('schemaVersion');
    expect(keys).not.toContain('_id');
  });

  it('names latitude and longitude, so a client never has to remember that GeoJSON puts longitude first', () => {
    expect(resourceFor(body).location).toEqual({ latitude: 28.4595, longitude: 77.0266 });
  });

  it('leaves location and source out when the restaurant has none', () => {
    const resource = resourceFor({ name: 'x', address: { city: 'Gurgaon', countryCode: 'IN' } });

    expect(resource).not.toHaveProperty('location');
    expect(resource).not.toHaveProperty('source');
    expect(resource.dataQuality).toEqual(['coords_missing']);
  });

  it('maps a document written by someone else without cost or rating to nulls instead of failing', () => {
    const doc = buildRestaurantDocument(createRestaurantSchema.parse(body), { tenantId: 't', now: NOW });
    delete doc.cost;
    delete doc.rating;

    const resource = toResource({ id: ID, doc });

    expect(resource.cost).toEqual({ forTwo: null, currency: null, priceRange: null });
    expect(resource.rating).toEqual({ average: null, votes: 0, label: null, score: null });
  });
});
