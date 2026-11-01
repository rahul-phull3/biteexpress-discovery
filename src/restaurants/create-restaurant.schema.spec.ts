import { issuesToFieldErrors, type FieldError } from '../http/problem';
import { createRestaurantSchema } from './create-restaurant.schema';

const valid = {
  name: 'Naivedhyam',
  address: { city: 'Gurgaon', countryCode: 'IN' },
};

/** Parses and expects the body to be accepted. */
function accepted(body: unknown) {
  const result = createRestaurantSchema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `expected the body to be accepted: ${JSON.stringify(issuesToFieldErrors(result.error.issues))}`,
    );
  }
  return result.data;
}

/** Parses and expects the body to be refused; returns the errors as the API reports them. */
function refused(body: unknown): FieldError[] {
  const result = createRestaurantSchema.safeParse(body);
  if (result.success) throw new Error('expected the body to be refused');
  return issuesToFieldErrors(result.error.issues);
}

const pointers = (body: unknown) => refused(body).map((error) => error.pointer);

describe('createRestaurantSchema: what it accepts', () => {
  it('accepts the smallest body: a name, a city and a country', () => {
    expect(accepted(valid)).toEqual({
      name: 'Naivedhyam',
      address: { city: 'Gurgaon', countryCode: 'IN' },
      cuisines: [],
    });
  });

  it('accepts a full body and fills in the defaults of the nested parts', () => {
    const data = accepted({
      ...valid,
      address: { ...valid.address, line: '12 Main Road', locality: 'Sector 29' },
      location: { latitude: 28.4595, longitude: 77.0266 },
      cuisines: ['South Indian', 'Vegetarian'],
      cost: { forTwo: 800, priceRange: 2 },
      rating: { average: 4.3, votes: 4385 },
      services: { onlineDelivery: true },
      source: { system: 'zomato', id: '18123456' },
    });

    expect(data.services).toEqual({
      tableBooking: false,
      onlineDelivery: true,
      deliveringNow: false,
    });
    expect(data.rating).toEqual({ average: 4.3, votes: 4385 });
    expect(data.location).toEqual({ latitude: 28.4595, longitude: 77.0266 });
  });

  it('tidies text: collapses whitespace, trims, upper-cases the country code', () => {
    const data = accepted({
      name: '  Barbeque \n  Nation  ',
      address: { city: ' New   Delhi ', countryCode: ' in ', line: ' 1 \t Road ' },
      cuisines: [' North   Indian '],
      source: { system: 'zomato', id: '  42  ' },
    });

    expect(data.name).toBe('Barbeque Nation');
    expect(data.address).toEqual({ city: 'New Delhi', countryCode: 'IN', line: '1 Road' });
    expect(data.cuisines).toEqual(['North Indian']);
    expect(data.source?.id).toBe('42');
  });

  it('accepts null for the optional text and number fields, as an explicit "unknown"', () => {
    const data = accepted({
      ...valid,
      address: { ...valid.address, line: null, locality: null },
      cost: { forTwo: null, priceRange: null },
      rating: { average: null },
    });

    expect(data.address.line).toBeNull();
    expect(data.cost).toEqual({ forTwo: null, priceRange: null });
    expect(data.rating).toEqual({ average: null, votes: 0 });
  });

  it('accepts votes without an average: an unrated restaurant can still have votes, as in the dataset', () => {
    expect(accepted({ ...valid, rating: { votes: 12 } }).rating).toEqual({ votes: 12 });
  });

  it('accepts every supported country code, in either letter case', () => {
    for (const code of ['AE', 'au', 'BR', 'ca', 'GB', 'us']) {
      expect(accepted({ ...valid, address: { city: 'X', countryCode: code } }).address.countryCode).toBe(code.toUpperCase());
    }
  });

  it('accepts a name of exactly 200 characters', () => {
    expect(accepted({ ...valid, name: 'n'.repeat(200) }).name).toHaveLength(200);
  });
});

describe('createRestaurantSchema: what it refuses', () => {
  describe('the body as a whole', () => {
    it.each([[null], [[]], ['text'], [42], [undefined]])('refuses %j and points at the root', (body) => {
      expect(pointers(body)).toEqual(['#']);
    });
  });

  describe('name and address', () => {
    it('requires a name, an address, a city and a country', () => {
      expect(pointers({})).toEqual(expect.arrayContaining(['#/name', '#/address']));
      expect(pointers({ name: 'x', address: {} })).toEqual(
        expect.arrayContaining(['#/address/city', '#/address/countryCode']),
      );
    });

    it('refuses a name that is only spaces', () => {
      expect(refused({ ...valid, name: '   ' })).toEqual([
        { pointer: '#/name', detail: 'must not be empty' },
      ]);
    });

    it('refuses a name longer than the database allows, with the reason', () => {
      expect(refused({ ...valid, name: 'n'.repeat(201) })).toEqual([
        { pointer: '#/name', detail: 'must be at most 200 characters' },
      ]);
    });

    it('refuses text of the wrong type', () => {
      expect(pointers({ ...valid, name: 5 })).toEqual(['#/name']);
      expect(pointers({ ...valid, address: { city: ['Gurgaon'], countryCode: 'IN' } })).toEqual(['#/address/city']);
    });

    it('refuses an unsupported country and lists the supported ones', () => {
      const [error] = refused({ ...valid, address: { city: 'X', countryCode: 'XX' } });

      expect(error?.pointer).toBe('#/address/countryCode');
      expect(error?.detail).toMatch(/^must be one of AE, AU, BR, CA, GB, ID, IN, LK, NZ, PH, QA, SG, TR, US, ZA$/);
    });

    it.each([['IND'], [''], ['I'], ['1N']])('refuses the country code %j', (code) => {
      expect(pointers({ ...valid, address: { city: 'X', countryCode: code } })).toEqual(['#/address/countryCode']);
    });
  });

  describe('fields the client does not own', () => {
    it.each([
      ['tenantId', { ...valid, tenantId: 'someone-else' }, '#/tenantId'],
      ['id', { ...valid, id: '507f1f77bcf86cd799439011' }, '#/id'],
      ['createdAt', { ...valid, createdAt: '2020-01-01T00:00:00Z' }, '#/createdAt'],
      ['status', { ...valid, status: 'inactive' }, '#/status'],
      ['a typo', { ...valid, cusines: ['Thai'] }, '#/cusines'],
      ['rating.score', { ...valid, rating: { average: 4, votes: 5, score: 5 } }, '#/rating/score'],
      ['rating.label', { ...valid, rating: { average: 4, votes: 5, label: 'Excellent' } }, '#/rating/label'],
      ['cost.currency', { ...valid, cost: { currency: 'USD' } }, '#/cost/currency'],
      ['address.country', { ...valid, address: { ...valid.address, country: { code: 'IN' } } }, '#/address/country'],
      ['location.type', { ...valid, location: { latitude: 28.4, longitude: 77, type: 'Point' } }, '#/location/type'],
    ])('refuses %s with a pointer to it', (_label, body, pointer) => {
      expect(refused(body)).toEqual([
        { pointer, detail: expect.stringContaining('Unknown field') },
      ]);
    });

    it('refuses a __proto__ key, which JSON.parse creates as an ordinary property', () => {
      const body = JSON.parse(
        '{"name":"x","address":{"city":"c","countryCode":"IN"},"__proto__":{"isAdmin":true}}',
      );

      expect(pointers(body)).toEqual(['#/__proto__']);
    });
  });

  describe('location', () => {
    const at = (latitude: number, longitude: number, countryCode = 'IN') => ({
      ...valid,
      address: { city: 'X', countryCode },
      location: { latitude, longitude },
    });

    it('accepts a point in India and a point abroad for another country', () => {
      expect(accepted(at(28.4595, 77.0266)).location).toBeDefined();
      expect(accepted(at(40.7128, -74.006, 'US')).location).toBeDefined();
    });

    it('refuses latitudes and longitudes that do not exist', () => {
      expect(pointers(at(91, 77, 'US'))).toEqual(['#/location/latitude']);
      expect(pointers(at(-91, 77, 'US'))).toEqual(['#/location/latitude']);
      expect(pointers(at(28, 181, 'US'))).toEqual(['#/location/longitude']);
    });

    it('requires both coordinates and refuses text', () => {
      expect(pointers({ ...valid, location: { latitude: 28 } })).toEqual(['#/location/longitude']);
      expect(pointers({ ...valid, location: { latitude: '28', longitude: '77' } })).toEqual([
        '#/location/latitude',
        '#/location/longitude',
      ]);
    });

    it('refuses 0, 0, which is what a missing value turns into', () => {
      expect(refused(at(0, 0))[0]?.pointer).toBe('#/location');
      expect(refused(at(0, 0, 'US'))[0]?.detail).toMatch(/not a real place/);
    });

    it('refuses coordinates outside India for an Indian restaurant and hints at swapped values', () => {
      const errors = refused(at(77.0266, 28.4595));

      expect(errors).toHaveLength(1);
      expect(errors[0]?.pointer).toBe('#/location');
      expect(errors[0]?.detail).toMatch(/outside India.*not swapped/);
    });
  });

  describe('cost', () => {
    it.each([[0], [-5], [100_000_001]])('refuses a cost for two of %s', (forTwo) => {
      expect(pointers({ ...valid, cost: { forTwo } })).toEqual(['#/cost/forTwo']);
    });

    it.each([[0], [5], [2.5], ['2']])('refuses a price range of %j', (priceRange) => {
      expect(pointers({ ...valid, cost: { priceRange } })).toEqual(['#/cost/priceRange']);
    });
  });

  describe('rating', () => {
    it.each([[0], [-1], [5.1], ['4.5']])('refuses an average of %j', (average) => {
      expect(pointers({ ...valid, rating: { average, votes: 10 } })).toEqual(['#/rating/average']);
    });

    it.each([[-1], [1.5], [1_000_000_001]])('refuses %s votes', (votes) => {
      expect(pointers({ ...valid, rating: { votes } })).toEqual(['#/rating/votes']);
    });

    it('refuses an average that no vote stands behind, whether votes is 0 or left out', () => {
      const expected = [
        { pointer: '#/rating/votes', detail: 'must be at least 1 when an average rating is given' },
      ];

      expect(refused({ ...valid, rating: { average: 4.2, votes: 0 } })).toEqual(expected);
      expect(refused({ ...valid, rating: { average: 4.2 } })).toEqual(expected);
    });
  });

  describe('cuisines, services and source', () => {
    it('refuses more than 20 cuisines, an empty cuisine and a cuisine of the wrong type', () => {
      expect(pointers({ ...valid, cuisines: Array.from({ length: 21 }, (_, i) => `c${i}`) })).toEqual(['#/cuisines']);
      expect(pointers({ ...valid, cuisines: ['Thai', ' '] })).toEqual(['#/cuisines/1']);
      expect(pointers({ ...valid, cuisines: ['Thai', 7] })).toEqual(['#/cuisines/1']);
      expect(pointers({ ...valid, cuisines: 'Thai' })).toEqual(['#/cuisines']);
    });

    it('refuses service flags that are not booleans', () => {
      expect(pointers({ ...valid, services: { tableBooking: 'yes' } })).toEqual(['#/services/tableBooking']);
    });

    it.each([['Zomato'], ['1abc'], [''], ['has space'], ['x'.repeat(41)]])(
      'refuses the source system %j',
      (system) => {
        expect(pointers({ ...valid, source: { system, id: '1' } })).toEqual(['#/source/system']);
      },
    );

    it('requires a source id of 1 to 100 characters', () => {
      expect(pointers({ ...valid, source: { system: 'zomato' } })).toEqual(['#/source/id']);
      expect(pointers({ ...valid, source: { system: 'zomato', id: '  ' } })).toEqual(['#/source/id']);
      expect(pointers({ ...valid, source: { system: 'zomato', id: 'i'.repeat(101) } })).toEqual(['#/source/id']);
    });
  });

  it('reports every faulty field at once, so a client fixes them in one round trip', () => {
    expect(
      pointers({
        name: '',
        address: { city: '', countryCode: 'XX' },
        cuisines: [''],
        cost: { priceRange: 9 },
      }).sort(),
    ).toEqual(['#/address/city', '#/address/countryCode', '#/cost/priceRange', '#/cuisines/0', '#/name']);
  });
});
