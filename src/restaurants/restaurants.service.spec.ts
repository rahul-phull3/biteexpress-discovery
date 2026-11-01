import { InMemoryRestaurantStore } from '../../test/support/in-memory-restaurant-store';
import { ProblemException } from '../http/problem';
import { createRestaurantSchema } from './create-restaurant.schema';
import type { RestaurantStore } from './restaurant.store';
import { RestaurantsService } from './restaurants.service';

const NOW = new Date('2026-11-01T10:30:00.000Z');

const input = (extra: object = {}) =>
  createRestaurantSchema.parse({
    name: 'Naivedhyam',
    address: { city: 'Gurgaon', countryCode: 'IN' },
    ...extra,
  });

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
    service = new RestaurantsService(store);
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
      };

      await expect(new RestaurantsService(broken).create('tenant-a', input(), NOW)).rejects.toThrow(
        'connection reset',
      );
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
});
