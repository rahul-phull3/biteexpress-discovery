import { InMemoryRestaurantStore } from '../../test/support/in-memory-restaurant-store';
import { createRestaurantSchema } from './create-restaurant.schema';
import { listQuerySchema } from './list-query.schema';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';
import { VocabularyService } from './vocabulary.service';

// The HTTP behaviour (status codes, validation, error format) is covered by
// test/restaurants.e2e-spec.ts. These specs cover the part of the controller
// that is its own decision: which headers it sets, and when.

function setup() {
  const store = new InMemoryRestaurantStore();
  const controller = new RestaurantsController(new RestaurantsService(store, new VocabularyService(store)));
  const headers = new Map<string, string>();
  const res = { setHeader: (name: string, value: string) => void headers.set(name, value) };
  const body = createRestaurantSchema.parse({
    name: 'Naivedhyam',
    address: { city: 'Gurgaon', countryCode: 'IN' },
  });
  return { controller, headers, res, body, store };
}

describe('RestaurantsController', () => {
  describe('create', () => {
    it('points the Location header at the new restaurant under /v1', async () => {
      const { controller, headers, res, body } = setup();

      const created = await controller.create('tenant-a', body, res);

      expect(headers.get('Location')).toBe(`/v1/restaurants/${created.id}`);
    });

    it('sets no Location header when nothing was created', async () => {
      const { controller, headers, res, body } = setup();
      const withSource = { ...body, source: { system: 'zomato', id: '1' } };
      await controller.create('tenant-a', withSource, res);
      headers.clear();

      await expect(controller.create('tenant-a', withSource, res)).rejects.toThrow();

      expect(headers.size).toBe(0);
    });
  });

  describe('get', () => {
    it('lets the app reuse the answer for 30 seconds and says that it depends on the tenant', async () => {
      const { controller, headers, res, body } = setup();
      const created = await controller.create('tenant-a', body, res);
      headers.clear();

      await controller.get('tenant-a', created.id, res);

      expect(headers.get('Cache-Control')).toBe('private, max-age=30');
      expect(headers.get('Vary')).toBe('X-Tenant-Id');
    });

    it('never marks a failure as cacheable', async () => {
      const { controller, headers, res } = setup();

      await expect(controller.get('tenant-a', 'f'.repeat(24), res)).rejects.toThrow();

      expect(headers.has('Cache-Control')).toBe(false);
      expect(headers.has('Vary')).toBe(false);
    });
  });

  describe('list', () => {
    it('lets the app reuse the page for 15 seconds and says that it depends on the tenant', async () => {
      const { controller, headers, res } = setup();

      await controller.list('tenant-a', listQuerySchema.parse({}), res);

      expect(headers.get('Cache-Control')).toBe('private, max-age=15');
      expect(headers.get('Vary')).toBe('X-Tenant-Id');
    });

    it('returns what the service found', async () => {
      const { controller, headers, res, body } = setup();
      await controller.create('tenant-a', body, res);
      headers.clear();

      const page = await controller.list('tenant-a', listQuerySchema.parse({ city: 'gurgaon' }), res);

      expect(page.data.map((item) => item.name)).toEqual(['Naivedhyam']);
    });

    it('never marks a failure as cacheable', async () => {
      const { controller, headers, res, store } = setup();
      jest.spyOn(store, 'list').mockRejectedValue(new Error('connection reset'));

      await expect(controller.list('tenant-a', listQuerySchema.parse({}), res)).rejects.toThrow();

      expect(headers.has('Cache-Control')).toBe(false);
      expect(headers.has('Vary')).toBe(false);
    });
  });
});
