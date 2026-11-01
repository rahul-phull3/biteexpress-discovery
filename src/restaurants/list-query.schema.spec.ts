import {
  DEFAULT_LIMIT,
  listQuerySchema,
  MAX_LIMIT,
  MAX_OFFSET,
  MAX_RADIUS_KM,
} from './list-query.schema';

type Query = Record<string, unknown>;

function parsed(query: Query) {
  const result = listQuerySchema.safeParse(query);
  if (!result.success) throw new Error(`expected a valid query: ${JSON.stringify(result.error.issues)}`);
  return result.data;
}

/** "path: message" for every problem found, in the order found. */
function problems(query: Query): string[] {
  const result = listQuerySchema.safeParse(query);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('listQuerySchema', () => {
  describe('what it accepts', () => {
    it('takes an empty query and fills in the defaults', () => {
      expect(parsed({})).toEqual({ cuisineMatch: 'any', limit: DEFAULT_LIMIT, offset: 0 });
      expect(DEFAULT_LIMIT).toBe(20);
    });

    it('turns text into numbers and flags', () => {
      expect(
        parsed({
          minRating: '4.5',
          minCost: '100',
          maxCost: '1000',
          priceRange: '2',
          delivery: 'true',
          booking: 'false',
          lat: '28.495',
          lng: '77.089',
          radiusKm: '2.5',
          limit: '10',
          offset: '30',
        }),
      ).toEqual({
        cuisineMatch: 'any',
        minRating: 4.5,
        minCost: 100,
        maxCost: 1000,
        priceRange: 2,
        delivery: true,
        booking: false,
        lat: 28.495,
        lng: 77.089,
        radiusKm: 2.5,
        limit: 10,
        offset: 30,
      });
    });

    it('accepts the ends of every range', () => {
      expect(parsed({ minRating: '0' }).minRating).toBe(0);
      expect(parsed({ minRating: '5' }).minRating).toBe(5);
      expect(parsed({ lat: '-90', lng: '-180' })).toMatchObject({ lat: -90, lng: -180 });
      expect(parsed({ lat: '90', lng: '180' })).toMatchObject({ lat: 90, lng: 180 });
      expect(parsed({ limit: String(MAX_LIMIT) }).limit).toBe(50);
      expect(parsed({ offset: String(MAX_OFFSET) }).offset).toBe(1000);
      expect(parsed({ lat: '1', lng: '1', radiusKm: String(MAX_RADIUS_KM) }).radiusKm).toBe(50);
      expect(parsed({ priceRange: '1' }).priceRange).toBe(1);
      expect(parsed({ priceRange: '4' }).priceRange).toBe(4);
    });

    it('tidies text: spaces are trimmed and runs of spaces become one', () => {
      expect(parsed({ name: '  Naive   dhyam ', city: ' New   Delhi ' })).toMatchObject({
        name: 'Naive dhyam',
        city: 'New Delhi',
      });
    });

    it('upper-cases the currency', () => {
      expect(parsed({ currency: 'inr' }).currency).toBe('INR');
    });

    it.each([
      ['in', 'IN'],
      ['IN', 'IN'],
      ['India', 'IN'],
      ['united kingdom', 'GB'],
      ['UK', 'GB'],
      ['usa', 'US'],
    ])('turns the country %s into the ISO code %s', (input, code) => {
      expect(parsed({ country: input }).country).toBe(code);
    });

    it('takes a cuisine given once, repeated, or separated by commas', () => {
      expect(parsed({ cuisine: 'Thai' }).cuisine).toEqual(['Thai']);
      expect(parsed({ cuisine: ['Thai', 'South Indian'] }).cuisine).toEqual(['Thai', 'South Indian']);
      expect(parsed({ cuisine: 'Thai, South  Indian' }).cuisine).toEqual(['Thai', 'South Indian']);
      expect(parsed({ cuisine: ['Thai,Chinese', 'Thai'] }).cuisine).toEqual(['Thai', 'Chinese']);
    });

    it('accepts a point with a sort other than distance in either direction', () => {
      expect(parsed({ lat: '1', lng: '2', sort: 'rating', order: 'desc' })).toMatchObject({ sort: 'rating' });
      expect(parsed({ lat: '1', lng: '2', sort: 'distance', order: 'asc' })).toMatchObject({ sort: 'distance' });
    });

    it('accepts a minimum cost equal to the maximum', () => {
      expect(problems({ minCost: '500', maxCost: '500' })).toEqual([]);
    });
  });

  describe('what it refuses, naming the parameter', () => {
    it.each<[string, string, string]>([
      ['minRating', 'abc', 'minRating: must be a number such as 4.5'],
      ['minRating', '5.1', 'minRating: must be between 0 and 5'],
      ['minRating', '-1', 'minRating: must be between 0 and 5'],
      ['minRating', '', 'minRating: must be a number such as 4.5'],
      ['minCost', '1.5', 'minCost: must be a whole number'],
      ['minCost', '-5', 'minCost: must be a whole number'],
      ['maxCost', 'cheap', 'maxCost: must be a whole number'],
      ['priceRange', '0', 'priceRange: must be between 1 and 4'],
      ['priceRange', '5', 'priceRange: must be between 1 and 4'],
      ['delivery', 'yes', 'delivery: must be true or false'],
      ['booking', '1', 'booking: must be true or false'],
      ['booking', 'TRUE', 'booking: must be true or false'],
      ['lat', '91', 'lat: must be between -90 and 90'],
      ['lng', '181', 'lng: must be between -180 and 180'],
      ['lat', 'north', 'lat: must be a number such as 4.5'],
      ['radiusKm', '0', 'radiusKm: must be greater than 0'],
      ['radiusKm', '51', 'radiusKm: must be at most 50'],
      ['radiusKm', '1e3', 'radiusKm: must be a number such as 4.5'],
      ['limit', '0', 'limit: must be between 1 and 50'],
      ['limit', '51', 'limit: must be between 1 and 50'],
      ['limit', '10.5', 'limit: must be a whole number'],
      ['limit', 'all', 'limit: must be a whole number'],
      ['offset', '1001', 'offset: must be between 0 and 1000'],
      ['offset', '-1', 'offset: must be a whole number'],
      ['cuisineMatch', 'some', "cuisineMatch: must be 'any' or 'all'"],
      ['sort', 'popularity', 'sort: must be one of distance, rating, averageRating, votes, cost, name, city'],
      ['order', 'up', "order: must be 'asc' or 'desc'"],
      ['currency', 'rupee', 'currency: must be a 3-letter currency code such as INR'],
      ['currency', 'R$', 'currency: must be a 3-letter currency code such as INR'],
      ['name', '', 'name: must not be empty'],
      ['city', '   ', 'city: must not be empty'],
      ['name', 'x'.repeat(101), 'name: must be at most 100 characters'],
      ['cuisine', ' , ', 'cuisine: must name at least one cuisine'],
      ['cuisine', 'x'.repeat(61), 'cuisine.0: each cuisine must be at most 60 characters'],
    ])('%s=%j', (parameter, value, expected) => {
      expect(problems({ [parameter]: value })).toContain(expected);
    });

    it('refuses a country it does not know and lists the codes it does', () => {
      const [problem] = problems({ country: 'Atlantis' });

      expect(problem).toContain('country: must be an ISO country code or a country name');
      expect(problem).toContain('IN');
    });

    it('refuses more than 20 cuisines', () => {
      const many = Array.from({ length: 21 }, (_, index) => `Cuisine ${index}`);

      expect(problems({ cuisine: many })).toContain('cuisine: at most 20 cuisines');
    });

    it('reports every faulty parameter at once, and each only once', () => {
      const found = problems({ minRating: 'abc', limit: 'all', delivery: 'maybe', radiusKm: '1e3' });

      expect(found.map((problem) => problem.split(':')[0]).sort()).toEqual([
        'delivery',
        'limit',
        'minRating',
        'radiusKm',
      ]);
    });

    it('does not follow a malformed number with a second error about NaN', () => {
      expect(problems({ lat: 'north' })).toEqual(['lat: must be a number such as 4.5']);
    });

    it('explains a cuisine that is neither text nor a list of text', () => {
      expect(problems({ cuisine: { $ne: 'Thai' } })).toEqual([
        'cuisine: must be a cuisine name, or several separated by commas',
      ]);
    });
  });

  describe('unknown parameters', () => {
    it('are refused, so a typo is reported instead of returning unfiltered results', () => {
      const result = listQuerySchema.safeParse({ citty: 'Gurgaon' });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['citty'] });
    });

    it('cannot smuggle in a field the endpoint does not offer', () => {
      expect(problems({ tenantId: 'someone-else' })).not.toEqual([]);
      expect(problems({ status: 'inactive' })).not.toEqual([]);
    });
  });

  describe('query operators', () => {
    it('are refused where Express would parse them to an object', () => {
      expect(problems({ city: { $ne: 'Gurgaon' } })).not.toEqual([]);
      expect(problems({ name: { $regex: '.*' } })).not.toEqual([]);
      expect(problems({ cuisine: { $ne: 'Thai' } })).not.toEqual([]);
      expect(problems({ minRating: { $gt: '0' } })).not.toEqual([]);
    });

    it('are refused as a parameter name, which is how Express 5 delivers ?city[$ne]=x', () => {
      const result = listQuerySchema.safeParse({ 'city[$ne]': 'x' });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['city[$ne]'] });
    });

    it('are refused as a list where one value is expected', () => {
      expect(problems({ city: ['Gurgaon', 'Noida'] })).not.toEqual([]);
      expect(problems({ limit: ['10', '20'] })).not.toEqual([]);
    });

    it('cannot be hidden in a key called __proto__', () => {
      const query = JSON.parse('{"__proto__": {"city": "x"}}') as Query;

      expect(listQuerySchema.safeParse(query).success).toBe(false);
    });
  });

  describe('parameters that only make sense together', () => {
    it('needs lng when lat is given, and lat when lng is given', () => {
      expect(problems({ lat: '28.5' })).toEqual(['lng: is required when lat is given']);
      expect(problems({ lng: '77.1' })).toEqual(['lat: is required when lng is given']);
    });

    it('needs a point for a radius', () => {
      expect(problems({ radiusKm: '3' })).toEqual(['radiusKm: needs lat and lng']);
    });

    it('needs a point to sort by distance', () => {
      expect(problems({ sort: 'distance' })).toEqual([
        'sort: distance needs lat and lng; there is nothing to measure from',
      ]);
    });

    it('sorts by distance nearest first only', () => {
      const expected = ['order: distance can only be sorted nearest first'];

      expect(problems({ lat: '1', lng: '2', sort: 'distance', order: 'desc' })).toEqual(expected);
    });

    it('applies the same rule when distance is only the default sort', () => {
      expect(problems({ lat: '1', lng: '2', order: 'desc' })).toEqual([
        'order: distance can only be sorted nearest first',
      ]);
    });

    it('allows a descending order without a point, where the default sort is the rating', () => {
      expect(problems({ order: 'desc' })).toEqual([]);
      expect(problems({ order: 'asc' })).toEqual([]);
    });

    it('does not let the minimum cost exceed the maximum', () => {
      expect(problems({ minCost: '600', maxCost: '500' })).toEqual([
        'minCost: must not be greater than maxCost',
      ]);
    });
  });
});
