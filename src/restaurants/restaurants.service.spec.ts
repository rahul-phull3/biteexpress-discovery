import { InMemoryRestaurantStore } from '../../test/support/in-memory-restaurant-store';
import { ProblemException } from '../http/problem';
import { createRestaurantSchema } from './create-restaurant.schema';
import { listQuerySchema } from './list-query.schema';
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
});
