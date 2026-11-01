import { buildListCriteria } from './list-criteria';
import { listQuerySchema } from './list-query.schema';
import { LIST_SORTS } from './list-sort';
import { Vocabulary } from './vocabulary';

const vocabulary = new Vocabulary({
  cities: [
    { name: 'Gurgaon', count: 1118 },
    { name: 'New Delhi', count: 5473 },
  ],
  cuisines: [
    { name: 'South Indian', count: 600 },
    { name: 'Thai', count: 400 },
  ],
});

const criteriaFor = (query: Record<string, unknown>) =>
  buildListCriteria(listQuerySchema.parse(query), vocabulary);

describe('buildListCriteria', () => {
  it('lists the best first by default, 20 to a page', () => {
    expect(criteriaFor({})).toEqual({
      cuisineMatch: 'any',
      sort: 'rating',
      order: 'desc',
      limit: 20,
      offset: 0,
    });
  });

  it('never carries a key whose value is undefined', () => {
    const everything = criteriaFor({
      name: 'dosa',
      city: 'gurugram',
      country: 'in',
      cuisine: 'thai',
      minRating: '4',
      minCost: '100',
      maxCost: '900',
      currency: 'inr',
      priceRange: '2',
      delivery: 'true',
      booking: 'false',
      lat: '28.5',
      lng: '77.1',
    });
    const bare = criteriaFor({});

    expect(Object.entries(everything).filter(([, value]) => value === undefined)).toEqual([]);
    expect(Object.keys(bare).sort()).toEqual(['cuisineMatch', 'limit', 'offset', 'order', 'sort']);
  });

  it('passes every filter on, under the names the store uses', () => {
    expect(
      criteriaFor({
        name: 'dosa',
        country: 'India',
        cuisineMatch: 'all',
        minRating: '4',
        minCost: '100',
        maxCost: '900',
        currency: 'inr',
        priceRange: '2',
        delivery: 'true',
        booking: 'false',
        limit: '5',
        offset: '10',
      }),
    ).toEqual({
      nameContains: 'dosa',
      countryCode: 'IN',
      cuisineMatch: 'all',
      minRating: 4,
      minCost: 100,
      maxCost: 900,
      currency: 'INR',
      priceRange: 2,
      delivery: true,
      booking: false,
      sort: 'rating',
      order: 'desc',
      limit: 5,
      offset: 10,
    });
  });

  it('writes the city and the cuisines the way the data does', () => {
    expect(criteriaFor({ city: 'gurugram' }).city).toBe('Gurgaon');
    expect(criteriaFor({ city: 'DELHI' }).city).toBe('New Delhi');
    expect(criteriaFor({ cuisine: ['south indian', 'THAI'] }).cuisines).toEqual(['South Indian', 'Thai']);
  });

  it('lists a cuisine once even when it was named in different spellings', () => {
    expect(criteriaFor({ cuisine: ['thai', 'Thai', 'THAI'] }).cuisines).toEqual(['Thai']);
  });

  it('keeps a city or cuisine that is not in the data, so that the query finds nothing', () => {
    expect(criteriaFor({ city: 'Atlantis' }).city).toBe('Atlantis');
    expect(criteriaFor({ cuisine: 'Martian' }).cuisines).toEqual(['Martian']);
  });

  describe('the point', () => {
    it('is the centre of the search, and the default sort becomes distance, nearest first', () => {
      const criteria = criteriaFor({ lat: '28.495', lng: '77.089' });

      expect(criteria.near).toEqual({ latitude: 28.495, longitude: 77.089 });
      expect(criteria).toMatchObject({ sort: 'distance', order: 'asc' });
    });

    it('carries the radius only when one was given', () => {
      expect(criteriaFor({ lat: '1', lng: '2' }).near).not.toHaveProperty('radiusKm');
      expect(criteriaFor({ lat: '1', lng: '2', radiusKm: '3' }).near).toEqual({
        latitude: 1,
        longitude: 2,
        radiusKm: 3,
      });
    });

    it('does not decide the sort when the request names one', () => {
      expect(criteriaFor({ lat: '1', lng: '2', sort: 'rating' })).toMatchObject({
        sort: 'rating',
        order: 'desc',
      });
    });
  });

  describe('the direction', () => {
    it.each([
      ['rating', 'desc'],
      ['averageRating', 'desc'],
      ['votes', 'desc'],
      ['cost', 'asc'],
      ['name', 'asc'],
      ['city', 'asc'],
      ['distance', 'asc'],
    ])('of %s is %s unless the request says otherwise', (sort, order) => {
      const query = { sort, lat: '1', lng: '2' };

      expect(criteriaFor(query)).toMatchObject({ sort, order });
    });

    it('is the one asked for', () => {
      expect(criteriaFor({ sort: 'name', order: 'desc' })).toMatchObject({ sort: 'name', order: 'desc' });
      expect(criteriaFor({ sort: 'rating', order: 'asc' })).toMatchObject({ sort: 'rating', order: 'asc' });
      expect(criteriaFor({ order: 'asc' })).toMatchObject({ sort: 'rating', order: 'asc' });
    });

    it('is defined for every sort the API offers', () => {
      for (const sort of LIST_SORTS) {
        expect(['asc', 'desc']).toContain(criteriaFor({ sort, lat: '1', lng: '2' }).order);
      }
    });
  });
});
