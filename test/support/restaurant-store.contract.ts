import type { RestaurantDocument } from '../../src/restaurants/restaurant.document';
import {
  DuplicateSourceError,
  type RestaurantStore,
} from '../../src/restaurants/restaurant.store';

let tenantCounter = 0;

/** A tenant id nobody used before in this process, so tests never see each other's data. */
export function freshTenant(prefix = 'contract'): string {
  tenantCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${tenantCounter}`;
}

/**
 * A complete, valid restaurant, written out by hand on purpose: it is the
 * reference for what the database must accept, independent of the code that
 * builds documents for the API.
 */
export function aRestaurantDocument(
  tenantId: string,
  extra: Partial<RestaurantDocument> = {},
): RestaurantDocument {
  const at = new Date('2026-11-01T10:00:00.000Z');
  return {
    tenantId,
    schemaVersion: 1,
    name: 'Naivedhyam',
    address: {
      line: '12 Main Road',
      locality: 'Sector 29',
      city: 'Gurgaon',
      country: { code: 'IN', name: 'India' },
    },
    location: { type: 'Point', coordinates: [77.0266, 28.4595] },
    cuisines: ['South Indian', 'Vegetarian'],
    cost: { forTwo: 800, currency: 'INR', priceRange: 2 },
    rating: { average: 4.3, votes: 4385, label: 'Very Good', score: 4.2903 },
    services: {
      tableBooking: false,
      onlineDelivery: true,
      deliveringNow: false,
    },
    status: 'active',
    dataQuality: [],
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

/**
 * What every RestaurantStore must do. It runs against the in-memory store in
 * `npm test` and against MongoDB in `npm run test:int`, which is what keeps
 * the stand-in honest: if the two ever disagree, one of those runs fails.
 */
export function describeRestaurantStoreContract(
  subject: string,
  makeStore: () => RestaurantStore,
): void {
  describe(`RestaurantStore contract: ${subject}`, () => {
    let store: RestaurantStore;

    beforeAll(() => {
      store = makeStore();
    });

    it('stores a restaurant and gives it a 24-character hexadecimal id', async () => {
      const stored = await store.insert(aRestaurantDocument(freshTenant()));

      expect(stored.id).toMatch(/^[0-9a-f]{24}$/);
    });

    it('gives every restaurant its own id', async () => {
      const tenant = freshTenant();
      const first = await store.insert(aRestaurantDocument(tenant));
      const second = await store.insert(aRestaurantDocument(tenant));

      expect(first.id).not.toBe(second.id);
    });

    it('finds a stored restaurant by id, exactly as it was stored', async () => {
      const tenant = freshTenant();
      const doc = aRestaurantDocument(tenant, {
        source: { system: 'zomato', id: '18123456' },
      });
      const { id } = await store.insert(doc);

      const found = await store.findById(tenant, id);

      expect(found).toEqual({ id, doc });
    });

    it('returns null for an id that does not exist', async () => {
      expect(await store.findById(freshTenant(), 'f'.repeat(24))).toBeNull();
    });

    it('does not show a restaurant to another tenant', async () => {
      const owner = freshTenant();
      const { id } = await store.insert(aRestaurantDocument(owner));

      expect(await store.findById(freshTenant(), id)).toBeNull();
      expect(await store.findById(owner, id)).not.toBeNull();
    });

    it('refuses a second restaurant with the same source in the same tenant', async () => {
      const tenant = freshTenant();
      const source = { system: 'zomato', id: '42' };
      await store.insert(aRestaurantDocument(tenant, { source }));

      const attempt = store.insert(
        aRestaurantDocument(tenant, { name: 'Copy', source }),
      );

      await expect(attempt).rejects.toBeInstanceOf(DuplicateSourceError);
      await expect(attempt).rejects.toMatchObject({ source });
    });

    it('allows the same source in another tenant', async () => {
      const source = { system: 'zomato', id: '42' };
      await store.insert(aRestaurantDocument(freshTenant(), { source }));

      await expect(
        store.insert(aRestaurantDocument(freshTenant(), { source })),
      ).resolves.toHaveProperty('id');
    });

    it('allows the same id from another source system', async () => {
      const tenant = freshTenant();
      await store.insert(
        aRestaurantDocument(tenant, { source: { system: 'zomato', id: '7' } }),
      );

      await expect(
        store.insert(
          aRestaurantDocument(tenant, {
            source: { system: 'legacy-erp', id: '7' },
          }),
        ),
      ).resolves.toHaveProperty('id');
    });

    it('allows any number of restaurants that have no source', async () => {
      const tenant = freshTenant();
      await store.insert(aRestaurantDocument(tenant));
      await store.insert(aRestaurantDocument(tenant));

      await expect(
        store.insert(aRestaurantDocument(tenant)),
      ).resolves.toHaveProperty('id');
    });
  });
}
