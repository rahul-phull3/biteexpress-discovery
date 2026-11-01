import { ProblemException } from '../http/problem';
import type { ListCriteria } from './list-criteria';
import { searchQuerySchema } from './list-query.schema';
import { mergeSearch, summarizeSearch } from './search-query';
import { parseSearchText } from './search-text';
import { Vocabulary } from './vocabulary';

const count = (name: string) => ({ name, count: 1 });

const vocabulary = new Vocabulary({
  cities: ['Gurgaon', 'New Delhi', 'Pune'].map(count),
  cuisines: ['Chinese', 'Pizza', 'South Indian', 'Thai'].map(count),
});

/** A request: its query-string parameters and its sentence. */
function merge(parameters: Record<string, unknown>, sentence?: string) {
  const request = searchQuerySchema.parse(sentence === undefined ? parameters : { ...parameters, q: sentence });
  const parsed =
    sentence === undefined
      ? { filters: {}, words: [], locationWanted: false, notes: [], priceNotes: [], radiusNotes: [] }
      : parseSearchText(request.q ?? '', vocabulary);
  return mergeSearch(request, parsed);
}

const POINT = { lat: '28.495', lng: '77.089' };

function problemOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof ProblemException) return error.problem;
    throw error;
  }
  throw new Error('expected a ProblemException');
}

describe('mergeSearch', () => {
  describe('a sentence alone', () => {
    it('becomes the query, with the defaults of the list', () => {
      const merged = merge({}, 'best South Indian food in Gurgaon');

      expect(merged.query).toEqual({
        city: 'Gurgaon',
        cuisine: ['South Indian'],
        sort: 'rating',
        cuisineMatch: 'any',
        limit: 20,
        offset: 0,
      });
      expect(merged.fromText).toEqual({ city: 'Gurgaon', cuisine: ['South Indian'], sort: 'rating' });
      expect(merged.overridden).toEqual([]);
      expect(merged.q).toBe('best South Indian food in Gurgaon');
    });

    it('uses the count in the sentence as the limit', () => {
      expect(merge({}, 'top 5 pizza').query.limit).toBe(5);
    });

    it('hands on the words for the store, and the notes of the reading', () => {
      const merged = merge({}, 'vada pav');

      expect(merged.words).toEqual(['vada', 'pav']);
      expect(merged.notes).toHaveLength(1);
    });
  });

  describe('parameters alone', () => {
    it('are the list query, with no q', () => {
      const merged = merge({ city: 'Pune', limit: '7' });

      expect(merged.query).toEqual({ city: 'Pune', cuisineMatch: 'any', limit: 7, offset: 0 });
      expect(merged.q).toBeNull();
      expect(merged.fromText).toEqual({});
    });
  });

  describe('a parameter and a sentence that both speak', () => {
    it('lets the parameter win, one by one, and says so', () => {
      const merged = merge({ city: 'Pune' }, 'pizza in Gurgaon');

      expect(merged.query).toMatchObject({ city: 'Pune', cuisine: ['Pizza'] });
      expect(merged.fromText).toEqual({ cuisine: ['Pizza'] });
      expect(merged.overridden).toEqual(['city']);
      expect(merged.notes).toEqual(["The request also sent city, so that was used instead of the text's."]);
    });

    it.each([
      [{ country: 'US' }, 'restaurants in India', 'country', 'US'],
      [{ cuisine: 'Thai' }, 'pizza', 'cuisine', ['Thai']],
      [{ minRating: '3' }, 'rated above 4', 'minRating', 3],
      [{ delivery: 'false' }, 'with online delivery', 'delivery', false],
      [{ booking: 'true' }, 'without table booking', 'booking', true],
      [{ limit: '9' }, 'top 5', 'limit', 9],
    ])('replaces the sentence with %j for "%s"', (parameters, sentence, key, expected) => {
      const merged = merge(parameters, sentence);

      expect((merged.query as unknown as Record<string, unknown>)[key]).toEqual(expected);
      expect(merged.overridden).toContain(key);
    });

    it('keeps the rest of the sentence when one of its parameters is replaced', () => {
      const merged = merge({ delivery: 'false' }, 'top 5 pizza with online delivery');

      expect(merged.query).toMatchObject({ delivery: false, limit: 5, cuisine: ['Pizza'], sort: 'rating' });
    });

    it('takes the sentence\'s price as one idea: a bound in the request replaces all of it', () => {
      const merged = merge({ maxCost: '500' }, 'between Rs 200 and Rs 800');

      expect(merged.query.maxCost).toBe(500);
      expect(merged.query.minCost).toBeUndefined();
      expect(merged.query.currency).toBeUndefined();
      expect(merged.overridden).toEqual(['minCost', 'maxCost', 'currency']);

      const onlyMin = merge({ minCost: '300' }, 'under 1000');
      expect(onlyMin.query).toMatchObject({ minCost: 300 });
      expect(onlyMin.query.maxCost).toBeUndefined();
    });

    it('does not repeat what the notes said about a price that was replaced', () => {
      const merged = merge({ maxCost: '500' }, 'under 1000 per person');

      expect(merged.notes).toEqual(["The request also sent maxCost, so that was used instead of the text's."]);
    });

    it("lets a currency in the request replace the sentence's, and keeps its amount", () => {
      const merged = merge({ currency: 'usd' }, 'under Rs 1000');

      expect(merged.query).toMatchObject({ maxCost: 999, currency: 'USD' });
      expect(merged.overridden).toEqual(['currency']);
    });

    it('takes the sort and its direction together', () => {
      const replaced = merge({ sort: 'name' }, 'most expensive pizza');
      expect(replaced.query).toMatchObject({ sort: 'name' });
      expect(replaced.query.order).toBeUndefined();
      expect(replaced.overridden).toEqual(['sort']);

      const reversed = merge({ order: 'asc' }, 'most expensive pizza');
      expect(reversed.query).toMatchObject({ sort: 'cost', order: 'asc' });
      expect(reversed.overridden).toEqual(['order']);
    });

    it('applies the name filter and the words of the sentence both', () => {
      const merged = merge({ name: 'dosa' }, 'vada pav');

      expect(merged.query.name).toBe('dosa');
      expect(merged.words).toEqual(['vada', 'pav']);
      expect(merged.overridden).toEqual([]);
    });
  });

  describe('distance', () => {
    it('is left out without a lat and lng, with a note, because a sentence cannot say where you are', () => {
      const merged = merge({}, 'nearest pizza within 3 km');

      expect(merged.query.sort).toBeUndefined();
      expect(merged.query.radiusKm).toBeUndefined();
      expect(merged.fromText).toEqual({ cuisine: ['Pizza'] });
      expect(merged.notes).toEqual([
        'The text asks for something near you, but the request has no lat and lng, so distance was not used.',
      ]);
    });

    it('also needs a location for "near me", and drops its 5 km with the rest', () => {
      const merged = merge({}, 'pizza near me');

      expect(merged.fromText).toEqual({ cuisine: ['Pizza'] });
      expect(merged.query.radiusKm).toBeUndefined();
      expect(merged.notes).toEqual([
        'The text asks for something near you, but the request has no lat and lng, so distance was not used.',
      ]);
    });

    it('notes the missing point for any distance the text asks for, even one that sets no radius', () => {
      const merged = merge({}, 'pizza within 0 km');

      expect(merged.query.radiusKm).toBeUndefined();
      expect(merged.notes).toEqual([
        'The text asks for something near you, but the request has no lat and lng, so distance was not used.',
      ]);
    });

    it('drops the note about a radius that was cut, with the radius', () => {
      const merged = merge({}, 'pizza within 100 km');

      expect(merged.query.radiusKm).toBeUndefined();
      expect(merged.notes).toEqual([
        'The text asks for something near you, but the request has no lat and lng, so distance was not used.',
      ]);
    });

    it('keeps the notes that are not about the radius when it is dropped', () => {
      const merged = merge({}, 'pizza near me open now');

      expect(merged.notes).toHaveLength(2);
      expect(merged.notes[0]).toBe('Opening hours are not in the data, so "open now" was ignored.');
    });

    it('reads "near me" as within 5 km when there is a location, and says so', () => {
      const merged = merge(POINT, 'pizza near me');

      expect(merged.query).toMatchObject({ lat: 28.495, lng: 77.089, cuisine: ['Pizza'], radiusKm: 5 });
      expect(merged.query.sort).toBeUndefined();
      expect(merged.notes).toEqual(['"near me" was read as within 5 km.']);
    });

    it('is the best rated within 5 km for "top 5 pizza places near me"', () => {
      const merged = merge(POINT, 'top 5 pizza places near me');

      expect(merged.query).toMatchObject({ cuisine: ['Pizza'], sort: 'rating', limit: 5, radiusKm: 5 });
    });

    it('is used with a lat and lng', () => {
      const merged = merge(POINT, 'nearest pizza within 3 km');

      expect(merged.query).toMatchObject({ lat: 28.495, lng: 77.089, sort: 'distance', radiusKm: 3 });
      expect(merged.notes).toEqual([]);
    });

    it('lets "best" replace the nearest-first default that a point brings', () => {
      expect(merge(POINT, 'best pizza').query.sort).toBe('rating');
      expect(merge(POINT, 'pizza').query.sort).toBeUndefined();
    });

    it('lets a radius in the request win', () => {
      const merged = merge({ ...POINT, radiusKm: '10' }, 'within 3 km');

      expect(merged.query.radiusKm).toBe(10);
      expect(merged.overridden).toEqual(['radiusKm']);
    });

    it('lets a radius in the request win over "near me" too, without repeating its 5 km', () => {
      const merged = merge({ ...POINT, radiusKm: '10' }, 'pizza near me');

      expect(merged.query.radiusKm).toBe(10);
      expect(merged.overridden).toEqual(['radiusKm']);
      expect(merged.notes).toEqual(["The request also sent radiusKm, so that was used instead of the text's."]);
    });

    it('does not repeat the note of a radius that was cut when the request sends its own', () => {
      const merged = merge({ ...POINT, radiusKm: '10' }, 'pizza within 100 km');

      expect(merged.query.radiusKm).toBe(10);
      expect(merged.notes).toEqual(["The request also sent radiusKm, so that was used instead of the text's."]);
    });

    it('keeps the note of a radius that was cut when the radius is used', () => {
      const merged = merge(POINT, 'pizza within 100 km');

      expect(merged.query.radiusKm).toBe(50);
      expect(merged.notes).toEqual(['The search radius is limited to 50 km; "within 100 km" was cut to that.']);
    });
  });

  describe('a request that contradicts its sentence', () => {
    it('is a 400 that names the parameter: order=desc with "nearest"', () => {
      const problem = problemOf(() => merge({ ...POINT, order: 'desc' }, 'nearest pizza'));

      expect(problem).toMatchObject({
        status: 400,
        type: '/problems/validation-error',
        errors: [{ parameter: 'order', detail: 'distance can only be sorted nearest first' }],
      });
    });

    it('is a 400 for order=desc with a point and nothing that says another sort, as it is for the list', () => {
      const problem = problemOf(() => merge({ ...POINT, order: 'desc' }));

      expect(problem.errors).toEqual([{ parameter: 'order', detail: 'distance can only be sorted nearest first' }]);
    });

    it('is fine when the sentence asks for a sort that can be reversed', () => {
      const merged = merge({ ...POINT, order: 'desc' }, 'best pizza');

      expect(merged.query).toMatchObject({ sort: 'rating', order: 'desc' });
    });

    it('is a 400 when a bound in the request contradicts the other bound in the request', () => {
      // The schema catches it first; the point is that the merge never produces it from a sentence.
      expect(() => searchQuerySchema.parse({ minCost: '900', maxCost: '100' })).toThrow();
      expect(merge({ minCost: '100' }, 'under 50').query.minCost).toBe(100);
    });
  });
});

describe('summarizeSearch', () => {
  const criteria = (overrides: Partial<ListCriteria> = {}): ListCriteria => ({
    cuisineMatch: 'any',
    sort: 'rating',
    order: 'desc',
    limit: 20,
    offset: 0,
    ...overrides,
  });

  it('says the three examples of the brief in one line each', () => {
    expect(summarizeSearch(criteria({ city: 'Gurgaon', cuisines: ['South Indian'] }))).toBe(
      'South Indian restaurants in Gurgaon, best rated first',
    );
    expect(summarizeSearch(criteria({ city: 'Gurgaon', maxCost: 999, currency: 'INR' }))).toBe(
      'Restaurants in Gurgaon, average cost for two at most 999 INR, best rated first',
    );
    expect(
      summarizeSearch(
        criteria({
          textWords: ['vada', 'pav'],
          near: { latitude: 28.495, longitude: 77.089 },
          sort: 'distance',
          order: 'asc',
        }),
      ),
    ).toBe('Restaurants with "vada pav" in the name or area, nearest first');
  });

  it('names the country, and puts it after the city when there is one', () => {
    expect(summarizeSearch(criteria({ countryCode: 'IN' }))).toBe('Restaurants in India, best rated first');
    expect(summarizeSearch(criteria({ city: 'Pune', countryCode: 'IN' }))).toBe(
      'Restaurants in Pune (India), best rated first',
    );
  });

  it('joins several cuisines with "or", or with "and" when all are required', () => {
    expect(summarizeSearch(criteria({ cuisines: ['Thai', 'Chinese'] }))).toBe('Thai or Chinese restaurants, best rated first');
    expect(summarizeSearch(criteria({ cuisines: ['Thai', 'Chinese'], cuisineMatch: 'all' }))).toBe(
      'Thai and Chinese restaurants, best rated first',
    );
  });

  it('mentions every filter that applies', () => {
    expect(
      summarizeSearch(
        criteria({
          nameContains: 'dosa',
          minCost: 200,
          maxCost: 800,
          priceRange: 2,
          minRating: 4,
          delivery: true,
          booking: false,
          near: { latitude: 1, longitude: 2, radiusKm: 3 },
          sort: 'distance',
          order: 'asc',
        }),
      ),
    ).toBe(
      'Restaurants with "dosa" in the name, average cost for two between 200 and 800, price range 2, rated 4 or more, with online delivery, without table booking, within 3 km, nearest first',
    );
  });

  it.each([
    ['rating', 'desc', 'best rated first'],
    ['rating', 'asc', 'lowest rated first'],
    ['averageRating', 'desc', 'highest average rating first'],
    ['votes', 'desc', 'most reviewed first'],
    ['cost', 'asc', 'cheapest first'],
    ['cost', 'desc', 'most expensive first'],
    ['name', 'asc', 'A to Z'],
    ['name', 'desc', 'Z to A'],
    ['city', 'asc', 'by city, A to Z'],
  ] as const)('says the order %s %s as "%s"', (sort, order, words) => {
    expect(summarizeSearch(criteria({ sort, order }))).toBe(`Restaurants, ${words}`);
  });
});
