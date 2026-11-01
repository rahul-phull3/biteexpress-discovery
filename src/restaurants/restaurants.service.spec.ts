import { InMemoryRestaurantStore } from '../../test/support/in-memory-restaurant-store';
import { ProblemException } from '../http/problem';
import { createRestaurantSchema } from './create-restaurant.schema';
import { listQuerySchema, searchQuerySchema } from './list-query.schema';
import type { RestaurantStore } from './restaurant.store';
import { RestaurantsService } from './restaurants.service';
import { VocabularyService } from './vocabulary.service';

const NOW = new Date('2026-11-01T10:30:00.000Z');

const input = (extra: object = {}) =>
  createRestaurantSchema.parse({
    name: 'Naivedhyam',
    address: { city: 'Gurgaon', countryCode: 'IN' },
    ...extra,
  });

const listQuery = (query: Record<string, unknown> = {}) => listQuerySchema.parse(query);

async function problemOf(promise: Promise<unknown>): Promise<ProblemException['problem']> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProblemException) return error.problem;
    throw error;
  }
  throw new Error('expected a ProblemException');
}

describe('RestaurantsService', () => {
  let store: InMemoryRestaurantStore;
  let service: RestaurantsService;

  beforeEach(() => {
    store = new InMemoryRestaurantStore();
    service = new RestaurantsService(store, new VocabularyService(store));
  });

  describe('create', () => {
    it('stores the restaurant for the tenant and returns it in its public shape', async () => {
      const created = await service.create('tenant-a', input(), NOW);

      expect(created.id).toMatch(/^[0-9a-f]{24}$/);
      expect(created).toMatchObject({
        name: 'Naivedhyam',
        status: 'active',
        createdAt: '2026-11-01T10:30:00.000Z',
      });
      expect(created).not.toHaveProperty('tenantId');
      expect(store.countFor('tenant-a')).toBe(1);
    });

    it('answers 409 with a pointer to the source when the tenant already has that source', async () => {
      const withSource = input({ source: { system: 'zomato', id: '42' } });
      await service.create('tenant-a', withSource, NOW);

      const problem = await problemOf(service.create('tenant-a', withSource, NOW));

      expect(problem).toMatchObject({
        status: 409,
        type: '/problems/conflict',
        detail: 'A restaurant with source zomato/42 already exists.',
        errors: [{ pointer: '#/source', detail: 'This source id is already used by another restaurant.' }],
      });
      expect(store.countFor('tenant-a')).toBe(1);
    });

    it('lets another tenant use the same source', async () => {
      const withSource = input({ source: { system: 'zomato', id: '42' } });
      await service.create('tenant-a', withSource, NOW);

      await expect(service.create('tenant-b', withSource, NOW)).resolves.toHaveProperty('id');
    });

    it('lets any number of restaurants without a source share a name', async () => {
      await service.create('tenant-a', input(), NOW);
      await expect(service.create('tenant-a', input(), NOW)).resolves.toHaveProperty('id');
    });

    it('does not hide a failure of the store behind a problem', async () => {
      const broken: RestaurantStore = {
        insert: async () => {
          throw new Error('connection reset');
        },
        findById: async () => null,
        list: async () => ({ items: [], hasMore: false }),
        vocabulary: async () => ({ cities: [], cuisines: [] }),
      };

      await expect(
        new RestaurantsService(broken, new VocabularyService(broken)).create('tenant-a', input(), NOW),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('get', () => {
    it('returns exactly what create returned', async () => {
      const created = await service.create('tenant-a', input({ cuisines: ['Thai'] }), NOW);

      expect(await service.get('tenant-a', created.id)).toEqual(created);
    });

    it('answers 404 for an id nobody has', async () => {
      const problem = await problemOf(service.get('tenant-a', 'f'.repeat(24)));

      expect(problem).toMatchObject({
        status: 404,
        type: '/problems/not-found',
        detail: `No restaurant has the id ${'f'.repeat(24)}.`,
      });
    });

    it("answers 404, not 403, for another tenant's restaurant, so its existence is not revealed", async () => {
      const created = await service.create('tenant-a', input(), NOW);

      const problem = await problemOf(service.get('tenant-b', created.id));

      expect(problem.status).toBe(404);
      expect(problem.detail).toBe(`No restaurant has the id ${created.id}.`);
    });
  });

  describe('list', () => {
    const serving = (name: string, extra: object = {}) =>
      input({ name, cuisines: ['South Indian'], rating: { average: 4, votes: 100 }, ...extra });

    it('answers with the page, the order that was applied and the time it took', async () => {
      await service.create('tenant-a', serving('Naivedhyam'), NOW);

      const response = await service.list('tenant-a', listQuery());

      expect(response.data).toHaveLength(1);
      expect(response.data[0]).toMatchObject({
        name: 'Naivedhyam',
        city: 'Gurgaon',
        country: 'India',
        cuisines: ['South Indian'],
        averageRating: 4,
      });
      expect(response.page).toEqual({ limit: 20, offset: 0, hasMore: false });
      expect(response.meta).toMatchObject({ sort: 'rating', order: 'desc' });
      expect(response.meta.tookMs).toBeGreaterThanOrEqual(0);
    });

    it("lists only the asking tenant's restaurants", async () => {
      await service.create('tenant-a', serving('Mine'), NOW);
      await service.create('tenant-b', serving('Theirs'), NOW);

      const response = await service.list('tenant-a', listQuery());

      expect(response.data.map((item) => item.name)).toEqual(['Mine']);
    });

    it('finds Gurgaon when the app says Gurugram, and South Indian when it says south indian', async () => {
      await service.create('tenant-a', serving('Naivedhyam'), NOW);

      const response = await service.list('tenant-a', listQuery({ city: 'gurugram', cuisine: 'south indian' }));

      expect(response.data.map((item) => item.name)).toEqual(['Naivedhyam']);
    });

    it('knows a new city at once: creating a restaurant makes the cached vocabulary stale', async () => {
      await service.create('tenant-a', serving('Naivedhyam'), NOW);
      await service.list('tenant-a', listQuery());

      await service.create(
        'tenant-a',
        input({ name: 'Pune Place', address: { city: 'Pune', countryCode: 'IN' } }),
        NOW,
      );
      const response = await service.list('tenant-a', listQuery({ city: 'pune' }));

      expect(response.data.map((item) => item.name)).toEqual(['Pune Place']);
    });

    it('asks the store for the vocabulary once for several listings', async () => {
      const spy = jest.spyOn(store, 'vocabulary');
      await service.create('tenant-a', serving('Naivedhyam'), NOW);

      await service.list('tenant-a', listQuery());
      await service.list('tenant-a', listQuery({ city: 'Gurgaon' }));
      await service.list('tenant-a', listQuery({ cuisine: 'Thai' }));

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('reports the distance only when the request has a point', async () => {
      await service.create('tenant-a', serving('Naivedhyam', { location: { latitude: 28.4595, longitude: 77.0266 } }), NOW);

      const near = await service.list('tenant-a', listQuery({ lat: '28.4595', lng: '77.0266' }));
      const anywhere = await service.list('tenant-a', listQuery());

      expect(near.data[0]).toMatchObject({ distanceKm: 0 });
      expect(near.meta).toMatchObject({ sort: 'distance', order: 'asc' });
      expect(anywhere.data[0]).not.toHaveProperty('distanceKm');
    });

    it('says whether another page follows', async () => {
      await service.create('tenant-a', serving('First'), NOW);
      await service.create('tenant-a', serving('Second'), NOW);

      const first = await service.list('tenant-a', listQuery({ limit: '1', sort: 'name' }));
      const second = await service.list('tenant-a', listQuery({ limit: '1', offset: '1', sort: 'name' }));

      expect(first.data.map((item) => item.name)).toEqual(['First']);
      expect(first.page).toEqual({ limit: 1, offset: 0, hasMore: true });
      expect(second.data.map((item) => item.name)).toEqual(['Second']);
      expect(second.page).toEqual({ limit: 1, offset: 1, hasMore: false });
    });

    it('reports the direction it chose when the request named only the sort', async () => {
      const response = await service.list('tenant-a', listQuery({ sort: 'name' }));

      expect(response.meta).toMatchObject({ sort: 'name', order: 'asc' });
    });

    it('lists nothing for a tenant without restaurants', async () => {
      const response = await service.list('nobody', listQuery());

      expect(response.data).toEqual([]);
      expect(response.page.hasMore).toBe(false);
    });

    it('does not hide a failure of the store behind an empty page', async () => {
      jest.spyOn(store, 'list').mockRejectedValue(new Error('connection reset'));

      await expect(service.list('tenant-a', listQuery())).rejects.toThrow('connection reset');
    });

    it('does not hide a failure to read the vocabulary, and tries again on the next request', async () => {
      const spy = jest.spyOn(store, 'vocabulary').mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.list('tenant-a', listQuery())).rejects.toThrow('connection reset');
      await expect(service.list('tenant-a', listQuery())).resolves.toHaveProperty('data');
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('search', () => {
    // Cyber Hub, Gurgaon: the point the "nearest" examples measure from.
    const here = { lat: '28.495', lng: '77.089' };
    const place = (name: string, extra: object = {}) => input({ name, ...extra });
    const where = (city: string, locality: string | null = null) => ({
      address: { city, locality, countryCode: 'IN' },
    });
    const at = (latitude: number, longitude: number) => ({ location: { latitude, longitude } });
    const request = (parameters: Record<string, unknown>) => searchQuerySchema.parse(parameters);
    const namesOf = (response: { data: Array<{ name: string }> }) => response.data.map((item) => item.name);
    const asQuery = (filters: object) =>
      Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? value : String(value)]));

    beforeEach(async () => {
      const restaurants: Array<[string, string, object]> = [
        ['Naivedhyam', 'tenant-a', { ...where('Gurgaon'), cuisines: ['South Indian'], rating: { average: 4.4, votes: 800 }, cost: { forTwo: 700 }, ...at(28.495, 77.089) }],
        ['Chennai Express', 'tenant-a', { ...where('Gurgaon'), cuisines: ['South Indian', 'Chinese'], rating: { average: 3.9, votes: 300 }, cost: { forTwo: 450 }, ...at(28.504, 77.089) }],
        ['Spice Route', 'tenant-a', { ...where('Gurgaon'), cuisines: ['North Indian'], rating: { average: 4.0, votes: 500 }, cost: { forTwo: 1500 }, ...at(28.54, 77.089) }],
        ['Goli Vada Pav No. 1', 'tenant-a', { ...where('Gurgaon', 'DLF Phase 3'), cuisines: ['Street Food'], rating: { average: 4.1, votes: 900 }, cost: { forTwo: 250 }, ...at(28.4937, 77.0987) }],
        ['Just Vada Pav', 'tenant-a', { ...where('New Delhi', 'Kalkaji'), cuisines: ['Street Food'], rating: { average: 4.6, votes: 3000 }, cost: { forTwo: 200 }, ...at(28.5494, 77.2588) }],
        ['Pune Place', 'tenant-a', { ...where('Pune'), cuisines: ['Cafe'], rating: { average: 4.5, votes: 50 }, cost: { forTwo: 600 }, ...at(18.5204, 73.8567) }],
        ['Their Vada Pav', 'tenant-b', { ...where('New Delhi'), cuisines: ['Street Food'] }],
      ];
      for (const [name, tenant, extra] of restaurants) await service.create(tenant, place(name, extra), NOW);
    });

    describe('the examples of the brief', () => {
      it('"Best restaurants in Gurgaon with South Indian Food"', async () => {
        const response = await service.search('tenant-a', request({ q: 'Best restaurants in Gurgaon with South Indian Food' }));

        expect(namesOf(response)).toEqual(['Naivedhyam', 'Chennai Express']);
        expect(response.meta).toMatchObject({ sort: 'rating', order: 'desc' });
        expect(response.interpretation).toEqual({
          q: 'Best restaurants in Gurgaon with South Indian Food',
          summary: 'South Indian restaurants in Gurgaon, best rated first',
          filters: { sort: 'rating', city: 'Gurgaon', cuisine: ['South Indian'] },
          words: [],
          overridden: [],
          notes: [],
        });
      });

      it('"Restaurants in Gurgaon under Rs. 1000 for two"', async () => {
        const response = await service.search('tenant-a', request({ q: 'Restaurants in Gurgaon under Rs. 1000 for two' }));

        // Spice Route costs 1500 for two.
        expect(namesOf(response)).toEqual(['Naivedhyam', 'Goli Vada Pav No. 1', 'Chennai Express']);
        expect(response.interpretation).toMatchObject({
          summary: 'Restaurants in Gurgaon, average cost for two at most 999 INR, best rated first',
          filters: { city: 'Gurgaon', maxCost: 999, currency: 'INR' },
          notes: [],
        });
      });

      it('"Nearest place that serves Vada Pav", given where you are', async () => {
        const response = await service.search('tenant-a', request({ q: 'Nearest place that serves Vada Pav', ...here }));

        expect(namesOf(response)).toEqual(['Goli Vada Pav No. 1', 'Just Vada Pav']);
        expect(response.data.map((item) => item.distanceKm)).toEqual([0.96, 17.68]);
        expect(response.meta).toMatchObject({ sort: 'distance', order: 'asc' });
        expect(response.interpretation).toMatchObject({
          summary: 'Restaurants with "vada pav" in the name or area, nearest first',
          filters: { sort: 'distance' },
          words: ['vada', 'pav'],
          overridden: [],
        });
        expect(response.interpretation.notes).toEqual([
          '"vada", "pav" are not a city, country, cuisine or filter, so each word must appear in a restaurant\'s name or area. The data has no menu items to search.',
        ]);
      });

      it('"Nearest place that serves Vada Pav", not knowing where you are: the best first, and it says why', async () => {
        const response = await service.search('tenant-a', request({ q: 'Nearest place that serves Vada Pav' }));

        expect(namesOf(response)).toEqual(['Just Vada Pav', 'Goli Vada Pav No. 1']);
        expect(response.meta).toMatchObject({ sort: 'rating', order: 'desc' });
        expect(response.data[0]).not.toHaveProperty('distanceKm');
        expect(response.interpretation.notes).toContain(
          'The text asks for something near you, but the request has no lat and lng, so distance was not used.',
        );
      });
    });

    describe('"near me"', () => {
      it('is within 5 km of the point, nearest first, and the answer says so', async () => {
        const response = await service.search('tenant-a', request({ q: 'restaurants near me', ...here }));

        // Spice Route is 5.01 km away; Just Vada Pav and Pune Place are further.
        expect(namesOf(response)).toEqual(['Naivedhyam', 'Goli Vada Pav No. 1', 'Chennai Express']);
        expect(response.meta).toMatchObject({ sort: 'distance', order: 'asc' });
        expect(response.interpretation).toMatchObject({
          summary: 'Restaurants, within 5 km, nearest first',
          filters: { radiusKm: 5 },
          notes: ['"near me" was read as within 5 km.'],
        });
      });

      it('with a word for the order means the best of those within 5 km, not the best anywhere', async () => {
        const response = await service.search('tenant-a', request({ q: 'top 2 restaurants near me', ...here }));

        // Just Vada Pav (4.6 from 3000 votes) is the best in the data, but 17.68 km away.
        expect(namesOf(response)).toEqual(['Naivedhyam', 'Goli Vada Pav No. 1']);
        expect(response.data.map((item) => item.distanceKm)).toEqual([0, 0.96]);
        expect(response.meta).toMatchObject({ sort: 'rating', order: 'desc' });
      });

      it('gives way to a distance, in the sentence or in the request', async () => {
        const inSentence = await service.search('tenant-a', request({ q: 'restaurants within 2 km near me', ...here }));
        expect(namesOf(inSentence)).toEqual(['Naivedhyam', 'Goli Vada Pav No. 1', 'Chennai Express']);
        expect(inSentence.interpretation.filters).toEqual({ radiusKm: 2 });
        expect(inSentence.interpretation.notes).toEqual([]);

        const inRequest = await service.search('tenant-a', request({ q: 'restaurants near me', radiusKm: '0.5', ...here }));
        expect(namesOf(inRequest)).toEqual(['Naivedhyam']);
        expect(inRequest.interpretation.overridden).toEqual(['radiusKm']);
        expect(inRequest.interpretation.notes).toEqual(["The request also sent radiusKm, so that was used instead of the text's."]);
      });

      it('is nothing at all without a point, which the answer says, and the restaurants come best first', async () => {
        const response = await service.search('tenant-a', request({ q: 'restaurants near me' }));

        expect(response.data).toHaveLength(6);
        expect(response.meta).toMatchObject({ sort: 'rating', order: 'desc' });
        expect(response.interpretation.filters).toEqual({});
        expect(response.interpretation.notes).toEqual([
          'The text asks for something near you, but the request has no lat and lng, so distance was not used.',
        ]);
      });
    });

    describe('what the sentence is turned into', () => {
      it.each([
        'Best restaurants in Gurgaon with South Indian Food',
        'Restaurants in Gurgaon under Rs. 1000 for two',
        'cheap street food in Delhi',
        'top 2 restaurants in Gurugram',
      ])('is exactly the parameters it reports: "%s" returns what the list returns for them', async (q) => {
        const searched = await service.search('tenant-a', request({ q }));
        const listed = await service.list('tenant-a', listQuerySchema.parse(asQuery(searched.interpretation.filters)));

        expect(namesOf(searched)).toEqual(namesOf(listed));
        expect(searched.page).toEqual(listed.page);
        expect(searched.meta).toMatchObject({ sort: listed.meta.sort, order: listed.meta.order });
      });

      it.each(['top 2 restaurants near me', 'cheap restaurants within 3 km', 'nearest restaurants'])(
        'is exactly the parameters it reports, with a point too: "%s"',
        async (q) => {
          const searched = await service.search('tenant-a', request({ q, ...here }));
          const listed = await service.list(
            'tenant-a',
            listQuerySchema.parse({ ...asQuery(searched.interpretation.filters), ...here }),
          );

          expect(namesOf(searched)).toEqual(namesOf(listed));
          expect(searched.page).toEqual(listed.page);
          expect(searched.meta).toMatchObject({ sort: listed.meta.sort, order: listed.meta.order });
        },
      );

      it('looks for a single digit too: "dlf phase 3" is not "dlf phase 2"', async () => {
        await service.create('tenant-a', place('Phase Two Cafe', where('Gurgaon', 'DLF Phase 2')), NOW);

        expect(namesOf(await service.search('tenant-a', request({ q: 'dlf phase 3' })))).toEqual(['Goli Vada Pav No. 1']);
        expect(namesOf(await service.search('tenant-a', request({ q: 'dlf phase 2' })))).toEqual(['Phase Two Cafe']);
      });

      it('finds a word in the locality as well as in the name', async () => {
        const response = await service.search('tenant-a', request({ q: 'dlf phase 3' }));

        expect(namesOf(response)).toEqual(['Goli Vada Pav No. 1']);
      });

      it('counts like the list: "top 2" is a page of two, with another page after it', async () => {
        const response = await service.search('tenant-a', request({ q: 'top 2 restaurants' }));

        expect(response.data).toHaveLength(2);
        expect(response.page).toEqual({ limit: 2, offset: 0, hasMore: true });
      });

      it('knows a city created a moment ago', async () => {
        await service.create('tenant-a', place('Kolkata Kitchen', where('Kolkata')), NOW);

        const response = await service.search('tenant-a', request({ q: 'restaurants in Calcutta' }));

        expect(namesOf(response)).toEqual(['Kolkata Kitchen']);
      });
    });

    describe('together with parameters', () => {
      it('lets a parameter win over the sentence, and says so', async () => {
        const response = await service.search('tenant-a', request({ q: 'restaurants in Gurgaon', city: 'Pune' }));

        expect(namesOf(response)).toEqual(['Pune Place']);
        expect(response.interpretation.overridden).toEqual(['city']);
        expect(response.interpretation.filters).toEqual({});
      });

      it('applies the name filter together with the words of the sentence', async () => {
        const response = await service.search('tenant-a', request({ q: 'dlf', name: 'goli' }));

        expect(namesOf(response)).toEqual(['Goli Vada Pav No. 1']);
        expect((await service.search('tenant-a', request({ q: 'dlf', name: 'just' }))).data).toEqual([]);
      });

      it('works without a sentence, as the list does', async () => {
        const searched = await service.search('tenant-a', request({ city: 'Gurgaon', maxCost: '500' }));
        const listed = await service.list('tenant-a', listQuerySchema.parse({ city: 'Gurgaon', maxCost: '500' }));

        expect(namesOf(searched)).toEqual(namesOf(listed));
        expect(searched.interpretation).toEqual({
          q: null,
          summary: 'Restaurants in Gurgaon, average cost for two at most 500, best rated first',
          filters: {},
          words: [],
          overridden: [],
          notes: [],
        });
      });

      it('answers 400 when the request contradicts its sentence', async () => {
        const problem = await problemOf(service.search('tenant-a', request({ q: 'nearest pizza', order: 'desc', ...here })));

        expect(problem).toMatchObject({
          status: 400,
          errors: [{ parameter: 'order', detail: 'distance can only be sorted nearest first' }],
        });
      });
    });

    describe('when nothing matches', () => {
      it('says that no restaurant has all of the words', async () => {
        const response = await service.search('tenant-a', request({ q: 'zzzz qqqq' }));

        expect(response.data).toEqual([]);
        expect(response.interpretation.notes).toContain('No restaurant has all of these words in its name or area. Fewer words will match more.');
      });

      it('does not say that about a page past the end of results that exist', async () => {
        const response = await service.search('tenant-a', request({ q: 'vada pav', offset: '10' }));

        expect(response.data).toEqual([]);
        expect(response.interpretation.notes.join(' ')).not.toContain('No restaurant has all');
      });

      it('does not talk about words when the filters matched nothing and there were no words', async () => {
        const response = await service.search('tenant-a', request({ q: 'South Indian restaurants in Pune' }));

        expect(response.data).toEqual([]);
        expect(response.interpretation.words).toEqual([]);
        expect(response.interpretation.notes.join(' ')).not.toContain('No restaurant has all');
      });

      it('lists everything, and says so, when nothing in the text is recognised', async () => {
        const response = await service.search('tenant-a', request({ q: 'restaurants' }));

        expect(response.data).toHaveLength(6);
        expect(response.interpretation.notes).toEqual([
          'Nothing in the text was recognised as a place, cuisine or filter, so no filter was applied.',
        ]);
      });
    });

    describe('isolation and failure', () => {
      it("searches only the asking tenant's restaurants", async () => {
        expect(namesOf(await service.search('tenant-b', request({ q: 'vada pav' })))).toEqual(['Their Vada Pav']);
        expect(namesOf(await service.search('tenant-a', request({ q: 'vada pav' })))).not.toContain('Their Vada Pav');
        expect((await service.search('tenant-c', request({ q: 'vada pav' }))).data).toEqual([]);
      });

      it('does not hide a failure of the store behind an empty page', async () => {
        jest.spyOn(store, 'list').mockRejectedValue(new Error('connection reset'));

        await expect(service.search('tenant-a', request({ q: 'pizza' }))).rejects.toThrow('connection reset');
      });
    });
  });
});
