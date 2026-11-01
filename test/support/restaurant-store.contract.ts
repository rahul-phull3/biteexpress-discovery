import type { ListCriteria } from '../../src/restaurants/list-criteria';
import type { RestaurantDocument } from '../../src/restaurants/restaurant.document';
import {
  DuplicateSourceError,
  type ListResult,
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

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

type Key = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12';

/**
 * Twelve restaurants of one tenant, built so that every rule has a case that
 * would go wrong without it. The expected orders in the tests below were worked
 * out by hand from this table.
 *
 *        name                    city       cuisines                   avg  votes score  cost       del book  position
 *   R1   Cyber Dosa              Gurgaon    South Indian               4.2   900  4.10   600 INR    yes  no   at the point P
 *   R2   Chennai Express         Gurgaon    South Indian, Chinese      3.9   300  3.60   450 INR    yes  yes  1.0 km from P
 *   R3   Dosa Plaza & Co         Gurgaon    South Indian, Fast Food    4.9     3  3.50  1000 INR    no   yes  2.0 km
 *   R4   Spice Route             Gurgaon    North Indian, Mughlai      4.0   500  3.90  1500 INR    no   yes  5.0 km
 *   R5   Unrated Cafe           Gurgaon    Cafe                       -       0  -        - INR    no   no   0.1 km
 *   R6   No Coordinates Kitchen  Gurgaon    South Indian               3.5   100  3.30   300 INR    no   no   unknown
 *   R7   Delhi Darbar            New Delhi  North Indian, Mughlai      4.5  2000  4.40  1200 INR    yes  yes  19.7 km
 *   R8   Vada Pav Junction      New Delhi  Street Food, Fast Food     4.0   700  3.95   250 INR    yes  no   20.6 km
 *   R9   Bombay Chowpatty        Mumbai     Street Food, Chinese       4.0   700  3.95   250 INR    yes  no   1132.6 km
 *   R10  Cafe (Bar) [Main]       Mumbai     Cafe, Bar Food             3.0    40  3.20   900 INR    no   no   1132.1 km
 *   R11  Maple Diner             New York   American, Burger           4.1  1500  4.00    60 USD    yes  yes  11775.6 km
 *   R12  Dollar Deluxe           New York   American, Steak            3.8   200  3.70   600 USD    no   yes  11775.0 km
 *
 * R8 and R9 tie on every rating value, so only the id can order them. P is
 * Cyber Hub, Gurgaon (28.495 N, 77.089 E). Every locality is "Central" except
 * R4's (Golf Course Road) and R9's (Girgaum), which the free-text tests look for.
 * The tenant also has an inactive
 * restaurant and a neighbour tenant has an excellent one, both at P: neither
 * may ever appear.
 */
const NAME: Record<Key, string> = {
  R1: 'Cyber Dosa',
  R2: 'Chennai Express',
  R3: 'Dosa Plaza & Co',
  R4: 'Spice Route',
  R5: 'Unrated Cafe',
  R6: 'No Coordinates Kitchen',
  R7: 'Delhi Darbar',
  R8: 'Vada Pav Junction',
  R9: 'Bombay Chowpatty',
  R10: 'Cafe (Bar) [Main]',
  R11: 'Maple Diner',
  R12: 'Dollar Deluxe',
};

/** The locality of the restaurants that do not have the default one. */
const LOCALITY: Partial<Record<Key, string>> = { R4: 'Golf Course Road', R9: 'Girgaum' };

/** Cyber Hub, Gurgaon. */
const P = { latitude: 28.495, longitude: 77.089 };

const INDIA = { code: 'IN', name: 'India' };
const USA = { code: 'US', name: 'United States' };

function fixtureRows(tenant: string): Array<[Key, RestaurantDocument]> {
  const at = (longitude: number, latitude: number) => ({
    location: { type: 'Point' as const, coordinates: [longitude, latitude] as [number, number] },
  });
  const rated = (average: number, votes: number, label: string, score: number) => ({
    rating: { average, votes, label, score },
  });
  const costing = (forTwo: number, currency: string, priceRange: number) => ({
    cost: { forTwo, currency, priceRange },
  });
  const services = (onlineDelivery: boolean, tableBooking: boolean) => ({
    services: { onlineDelivery, tableBooking, deliveringNow: false },
  });
  const row = (
    key: Key,
    city: string,
    country: { code: string; name: string },
    cuisines: string[],
    extra: Partial<RestaurantDocument>,
  ): [Key, RestaurantDocument] => [
    key,
    aRestaurantDocument(tenant, {
      name: NAME[key],
      address: { line: `${key} Road`, locality: LOCALITY[key] ?? 'Central', city, country },
      cuisines,
      ...extra,
    }),
  ];

  const unlocated = row('R6', 'Gurgaon', INDIA, ['South Indian'], {
    ...rated(3.5, 100, 'Good', 3.3),
    ...costing(300, 'INR', 1),
    ...services(false, false),
  });
  // No position at all: the key must be absent, because null would break the database validator.
  delete unlocated[1].location;

  return [
    row('R1', 'Gurgaon', INDIA, ['South Indian'], {
      ...rated(4.2, 900, 'Very Good', 4.1),
      ...costing(600, 'INR', 2),
      ...services(true, false),
      ...at(77.089, 28.495),
    }),
    row('R2', 'Gurgaon', INDIA, ['South Indian', 'Chinese'], {
      ...rated(3.9, 300, 'Good', 3.6),
      ...costing(450, 'INR', 1),
      ...services(true, true),
      ...at(77.089, 28.504),
    }),
    row('R3', 'Gurgaon', INDIA, ['South Indian', 'Fast Food'], {
      ...rated(4.9, 3, 'Excellent', 3.5),
      ...costing(1000, 'INR', 3),
      ...services(false, true),
      ...at(77.109, 28.495),
    }),
    row('R4', 'Gurgaon', INDIA, ['North Indian', 'Mughlai'], {
      ...rated(4.0, 500, 'Very Good', 3.9),
      ...costing(1500, 'INR', 4),
      ...services(false, true),
      ...at(77.089, 28.54),
    }),
    row('R5', 'Gurgaon', INDIA, ['Cafe'], {
      rating: { average: null, votes: 0, label: null, score: null },
      cost: { forTwo: null, currency: 'INR', priceRange: null },
      ...services(false, false),
      ...at(77.089, 28.496),
    }),
    unlocated,
    row('R7', 'New Delhi', INDIA, ['North Indian', 'Mughlai'], {
      ...rated(4.5, 2000, 'Excellent', 4.4),
      ...costing(1200, 'INR', 3),
      ...services(true, true),
      ...at(77.2167, 28.6315),
    }),
    row('R8', 'New Delhi', INDIA, ['Street Food', 'Fast Food'], {
      ...rated(4.0, 700, 'Very Good', 3.95),
      ...costing(250, 'INR', 1),
      ...services(true, false),
      ...at(77.22, 28.64),
    }),
    row('R9', 'Mumbai', INDIA, ['Street Food', 'Chinese'], {
      ...rated(4.0, 700, 'Very Good', 3.95),
      ...costing(250, 'INR', 1),
      ...services(true, false),
      ...at(72.8777, 19.076),
    }),
    row('R10', 'Mumbai', INDIA, ['Cafe', 'Bar Food'], {
      ...rated(3.0, 40, 'Average', 3.2),
      ...costing(900, 'INR', 2),
      ...services(false, false),
      ...at(72.88, 19.08),
    }),
    row('R11', 'New York', USA, ['American', 'Burger'], {
      ...rated(4.1, 1500, 'Very Good', 4.0),
      ...costing(60, 'USD', 3),
      ...services(true, true),
      ...at(-74.006, 40.7128),
    }),
    row('R12', 'New York', USA, ['American', 'Steak'], {
      ...rated(3.8, 200, 'Good', 3.7),
      ...costing(600, 'USD', 3),
      ...services(false, true),
      ...at(-74.01, 40.72),
    }),
  ];
}

/** Criteria with the fewest assumptions: everything, best first, one big page. */
function criteria(overrides: Partial<ListCriteria> = {}): ListCriteria {
  return { cuisineMatch: 'any', sort: 'rating', order: 'desc', limit: 50, offset: 0, ...overrides };
}

/** The names a result lists, in order. */
const namesOf = (result: ListResult): string[] => result.items.map((item) => item.doc.name);

/** The names of these fixture restaurants, in this order. */
const inOrder = (...keys: Key[]): string[] => keys.map((key) => NAME[key]);

/**
 * What every RestaurantStore must do when listing. Like the contract above, it
 * runs against the in-memory store in `npm test` and against MongoDB in
 * `npm run test:int`.
 */
export function describeRestaurantListContract(
  subject: string,
  makeStore: () => RestaurantStore,
): void {
  describe(`RestaurantStore listing contract: ${subject}`, () => {
    let store: RestaurantStore;
    let tenant: string;
    let ids: Record<string, string>;

    const list = async (overrides: Partial<ListCriteria> = {}) =>
      store.list(tenant, criteria(overrides));
    const names = async (overrides: Partial<ListCriteria> = {}) => namesOf(await list(overrides));

    beforeAll(async () => {
      store = makeStore();
      tenant = freshTenant('listing');
      ids = {};
      for (const [key, doc] of fixtureRows(tenant)) {
        ids[key] = (await store.insert(doc)).id;
      }

      // Never visible: an inactive restaurant of this tenant, and an excellent
      // one of another tenant, both exactly at P.
      const atP = { location: { type: 'Point' as const, coordinates: [P.longitude, P.latitude] as [number, number] } };
      const excellent = { average: 5, votes: 10000, label: 'Excellent', score: 4.9 };
      await store.insert(
        aRestaurantDocument(tenant, { name: 'Closed Place', status: 'inactive', rating: excellent, ...atP }),
      );
      await store.insert(
        aRestaurantDocument(freshTenant('neighbour'), { name: 'Neighbour Dosa', rating: excellent, ...atP }),
      );
    });

    describe('which restaurants it lists', () => {
      it("lists the tenant's active restaurants only", async () => {
        expect(await names()).toHaveLength(12);
        expect(await names()).not.toContain('Closed Place');
        expect(await names()).not.toContain('Neighbour Dosa');
      });

      it('gives each row the id the restaurant was stored with', async () => {
        const first = (await list()).items[0];

        expect(first?.id).toBe(ids.R7);
        expect(first?.doc.name).toBe(NAME.R7);
      });

      it('matches a city exactly, so that its index can be used', async () => {
        expect(await names({ city: 'Gurgaon' })).toEqual(inOrder('R1', 'R4', 'R2', 'R3', 'R6', 'R5'));
        expect(await names({ city: 'gurgaon' })).toEqual([]);
      });

      it('filters by country code', async () => {
        expect(await names({ countryCode: 'US' })).toEqual(inOrder('R11', 'R12'));
      });

      it('finds a part of a name in any letter case', async () => {
        expect(await names({ nameContains: 'dosa' })).toEqual(inOrder('R1', 'R3'));
        expect(await names({ nameContains: 'DOSA PLAZA & co' })).toEqual(inOrder('R3'));
      });

      it('takes the name literally, so that pattern characters cannot change what matches', async () => {
        // Unescaped, "(bar)" would also match "Delhi Darbar", "." would match everything
        // and "[main]" would match any name with an m, a, i or n.
        expect(await names({ nameContains: '(bar)' })).toEqual(inOrder('R10'));
        expect(await names({ nameContains: '.' })).toEqual([]);
        expect(await names({ nameContains: '[main]' })).toEqual(inOrder('R10'));
      });

      it('needs every word of a free-text search, in any letter case, in the name or the locality', async () => {
        expect(await names({ textWords: ['vada', 'pav'] })).toEqual(inOrder('R8'));
        expect(await names({ textWords: ['PAV', 'Junction'] })).toEqual(inOrder('R8'));
        expect(await names({ textWords: ['pav', 'vada'] })).toEqual(inOrder('R8'));
        expect(await names({ textWords: ['dosa'] })).toEqual(inOrder('R1', 'R3'));
        // No restaurant has both words.
        expect(await names({ textWords: ['vada', 'dosa'] })).toEqual([]);
      });

      it('lets one word sit in the name and the next in the locality', async () => {
        // R4 is "Spice Route" in "Golf Course Road"; R9 is "Bombay Chowpatty" in "Girgaum".
        expect(await names({ textWords: ['golf'] })).toEqual(inOrder('R4'));
        expect(await names({ textWords: ['spice', 'golf'] })).toEqual(inOrder('R4'));
        expect(await names({ textWords: ['chowpatty', 'GIRGAUM'] })).toEqual(inOrder('R9'));
        expect(await names({ textWords: ['spice', 'girgaum'] })).toEqual([]);
      });

      it('takes the words of a free-text search literally, like a name', async () => {
        expect(await names({ textWords: ['.'] })).toEqual([]);
        expect(await names({ textWords: ['(bar)'] })).toEqual(inOrder('R10'));
        expect(await names({ textWords: ['[main]'] })).toEqual(inOrder('R10'));
        expect(await names({ textWords: ['.*'] })).toEqual([]);
      });

      it('combines the words with every other filter, name included', async () => {
        expect(await names({ city: 'Gurgaon', textWords: ['dosa'] })).toEqual(inOrder('R1', 'R3'));
        expect(await names({ city: 'Mumbai', textWords: ['dosa'] })).toEqual([]);
        expect(await names({ nameContains: 'dosa', textWords: ['plaza'] })).toEqual(inOrder('R3'));
        expect(await names({ nameContains: 'dosa', textWords: ['spice'] })).toEqual([]);
      });

      it('does not filter when the list of words is empty', async () => {
        expect(await names({ textWords: [] })).toHaveLength(12);
      });

      it('matches any of several cuisines by default', async () => {
        expect(await names({ cuisines: ['South Indian'] })).toEqual(inOrder('R1', 'R2', 'R3', 'R6'));
        expect(await names({ cuisines: ['South Indian', 'Mughlai'] })).toEqual(
          inOrder('R7', 'R1', 'R4', 'R2', 'R3', 'R6'),
        );
      });

      it('can require every one of several cuisines', async () => {
        const all = { cuisineMatch: 'all' as const };

        expect(await names({ ...all, cuisines: ['South Indian', 'Chinese'] })).toEqual(inOrder('R2'));
        expect(await names({ ...all, cuisines: ['Street Food', 'Fast Food'] })).toEqual(inOrder('R8'));
        expect(await names({ ...all, cuisines: ['South Indian', 'Mughlai'] })).toEqual([]);
      });

      it('keeps restaurants whose average rating reaches the minimum, and never an unrated one', async () => {
        expect(await names({ minRating: 4 })).toEqual(
          inOrder('R7', 'R1', 'R11', 'R8', 'R9', 'R4', 'R3'),
        );
        expect(await names({ minRating: 4.5 })).toEqual(inOrder('R7', 'R3'));
      });

      it('bounds the cost for two inclusively, in the currency asked for, and never matches an unknown cost', async () => {
        expect(await names({ currency: 'INR', maxCost: 450 })).toEqual(inOrder('R8', 'R9', 'R2', 'R6'));
        expect(await names({ currency: 'INR', minCost: 1000 })).toEqual(inOrder('R7', 'R4', 'R3'));
        expect(await names({ currency: 'INR', minCost: 450, maxCost: 1000 })).toEqual(
          inOrder('R1', 'R2', 'R3', 'R10'),
        );
      });

      it('compares the amounts as they are when no currency is given, which is why a currency exists', async () => {
        // 60 US dollars is "under 450" only because the numbers are compared as they are.
        expect(await names({ maxCost: 450 })).toEqual(inOrder('R11', 'R8', 'R9', 'R2', 'R6'));
        expect(await names({ currency: 'USD' })).toEqual(inOrder('R11', 'R12'));
      });

      it('filters by price range', async () => {
        expect(await names({ priceRange: 1 })).toEqual(inOrder('R8', 'R9', 'R2', 'R6'));
      });

      it('filters by online delivery and table booking, and by both', async () => {
        expect(await names({ delivery: true })).toEqual(inOrder('R7', 'R1', 'R11', 'R8', 'R9', 'R2'));
        expect(await names({ delivery: false })).toEqual(inOrder('R4', 'R12', 'R3', 'R6', 'R10', 'R5'));
        expect(await names({ booking: true })).toEqual(inOrder('R7', 'R11', 'R4', 'R12', 'R2', 'R3'));
        expect(await names({ delivery: true, booking: true })).toEqual(inOrder('R7', 'R11', 'R2'));
      });

      it('combines all the filters it is given', async () => {
        expect(
          await names({ city: 'Gurgaon', cuisines: ['South Indian'], minRating: 3.9 }),
        ).toEqual(inOrder('R1', 'R2', 'R3'));
      });

      it('lists nothing, and no further page, when nothing matches', async () => {
        const result = await list({ city: 'Atlantis' });

        expect(result).toEqual({ items: [], hasMore: false });
      });
    });

    describe('what a row contains', () => {
      it('has the name, address, cuisines, cost and rating, exactly as stored, and nothing else', async () => {
        const row = (await list({ nameContains: 'Cyber Dosa' })).items[0];

        expect(row?.doc).toEqual({
          name: 'Cyber Dosa',
          address: { line: 'R1 Road', locality: 'Central', city: 'Gurgaon', country: INDIA },
          cuisines: ['South Indian'],
          cost: { forTwo: 600, currency: 'INR', priceRange: 2 },
          rating: { average: 4.2, votes: 900, label: 'Very Good', score: 4.1 },
        });
        expect(Object.keys(row?.doc ?? {}).sort()).toEqual(['address', 'cost', 'cuisines', 'name', 'rating']);
      });

      it('keeps the nulls of an unrated restaurant', async () => {
        const row = (await list({ nameContains: 'Unrated' })).items[0];

        expect(row?.doc.rating).toEqual({ average: null, votes: 0, label: null, score: null });
        expect(row?.doc.cost).toEqual({ forTwo: null, currency: 'INR', priceRange: null });
      });

      it('has no distance when the listing has no point', async () => {
        for (const item of (await list()).items) expect(item).not.toHaveProperty('distanceKm');
      });
    });

    describe('how it orders', () => {
      it('puts the best first by default, unrated last, and breaks a tie by id', async () => {
        // R8 and R9 tie on score; R8 was stored first.
        expect(await names()).toEqual(
          inOrder('R7', 'R1', 'R11', 'R8', 'R9', 'R4', 'R12', 'R2', 'R3', 'R6', 'R10', 'R5'),
        );
      });

      it('reverses the whole list, ties included, when asked for the worst first, and leaves out the unrated', async () => {
        expect(await names({ sort: 'rating', order: 'asc' })).toEqual(
          inOrder('R10', 'R6', 'R3', 'R2', 'R12', 'R4', 'R9', 'R8', 'R11', 'R1', 'R7'),
        );
      });

      it('sorts by the plain average, ties by votes, then by id', async () => {
        // R8, R9 and R4 all average 4.0; R8 and R9 have 700 votes (R8 first), R4 has 500.
        expect(await names({ sort: 'averageRating', order: 'desc' })).toEqual(
          inOrder('R3', 'R7', 'R1', 'R11', 'R8', 'R9', 'R4', 'R2', 'R12', 'R6', 'R10', 'R5'),
        );
        expect(await names({ sort: 'averageRating', order: 'asc' })).toEqual(
          inOrder('R10', 'R6', 'R12', 'R2', 'R4', 'R9', 'R8', 'R11', 'R1', 'R7', 'R3'),
        );
      });

      it('sorts by number of votes, most first', async () => {
        expect(await names({ sort: 'votes', order: 'desc' })).toEqual(
          inOrder('R7', 'R11', 'R1', 'R8', 'R9', 'R4', 'R2', 'R12', 'R6', 'R10', 'R3', 'R5'),
        );
        expect(await names({ sort: 'votes', order: 'asc' })).toEqual(
          inOrder('R5', 'R3', 'R10', 'R6', 'R12', 'R2', 'R4', 'R9', 'R8', 'R1', 'R11', 'R7'),
        );
      });

      it('sorts by cost: cheapest first leaves out unknown costs, dearest first puts them last', async () => {
        const rupees = { currency: 'INR', sort: 'cost' as const };

        expect(await names({ ...rupees, order: 'asc' })).toEqual(
          inOrder('R8', 'R9', 'R6', 'R2', 'R1', 'R10', 'R3', 'R7', 'R4'),
        );
        expect(await names({ ...rupees, order: 'desc' })).toEqual(
          inOrder('R4', 'R7', 'R3', 'R10', 'R1', 'R2', 'R6', 'R9', 'R8', 'R5'),
        );
      });

      it('sorts by name in plain character order', async () => {
        const az = inOrder('R9', 'R10', 'R2', 'R1', 'R7', 'R12', 'R3', 'R11', 'R6', 'R4', 'R5', 'R8');

        expect(await names({ sort: 'name', order: 'asc' })).toEqual(az);
        expect(await names({ sort: 'name', order: 'desc' })).toEqual([...az].reverse());
      });

      it('sorts by city, and inside a city the best restaurant is always first', async () => {
        expect(await names({ sort: 'city', order: 'asc' })).toEqual(
          inOrder('R1', 'R4', 'R2', 'R3', 'R6', 'R5', 'R9', 'R10', 'R7', 'R8', 'R11', 'R12'),
        );
        expect(await names({ sort: 'city', order: 'desc' })).toEqual(
          inOrder('R11', 'R12', 'R7', 'R8', 'R9', 'R10', 'R1', 'R4', 'R2', 'R3', 'R6', 'R5'),
        );
      });

      it('refuses to sort by distance when there is no point to measure from', async () => {
        await expect(list({ sort: 'distance', order: 'asc' })).rejects.toThrow();
      });
    });

    describe('paging', () => {
      it('cuts the same order into pages that neither overlap nor skip a restaurant', async () => {
        const whole = await names();
        const pages = [];
        for (const offset of [0, 5, 10]) pages.push(await list({ limit: 5, offset }));

        expect(pages.map(namesOf)).toEqual([whole.slice(0, 5), whole.slice(5, 10), whole.slice(10)]);
        expect(pages.map((page) => page.hasMore)).toEqual([true, true, false]);
      });

      it('knows whether another page follows, also when the page ends exactly at the last restaurant', async () => {
        expect((await list({ limit: 12 })).hasMore).toBe(false);
        expect((await list({ limit: 11 })).hasMore).toBe(true);
        expect((await list({ limit: 1, offset: 11 })).hasMore).toBe(false);
      });

      it('returns an empty page after the last restaurant', async () => {
        expect(await list({ offset: 12 })).toEqual({ items: [], hasMore: false });
        expect(await list({ offset: 40, limit: 5 })).toEqual({ items: [], hasMore: false });
      });
    });

    describe('near a point', () => {
      const near = { ...P };

      it('lists the nearest first, with the distance in kilometres to 10 metres, and never one without coordinates', async () => {
        const result = await list({ near, sort: 'distance', order: 'asc' });

        expect(namesOf(result)).toEqual(
          inOrder('R1', 'R5', 'R2', 'R3', 'R4', 'R7', 'R8', 'R10', 'R9', 'R12', 'R11'),
        );
        const km = result.items.map((item) => item.distanceKm ?? NaN);
        expect(km[0]).toBeCloseTo(0, 2);
        expect(km[1]).toBeCloseTo(0.11, 2);
        expect(km[2]).toBeCloseTo(1.0, 2);
        expect(km[3]).toBeCloseTo(1.96, 2);
        expect(km[4]).toBeCloseTo(5.01, 2);
        expect(km[5]).toBeCloseTo(19.67, 2);
        expect(km[6]).toBeCloseTo(20.61, 1);
        expect(km[7]).toBeCloseTo(1132.07, 1);
        expect(km[10]).toBeCloseTo(11775.61, 1);
      });

      it('keeps only restaurants within the radius', async () => {
        const result = await list({ near: { ...P, radiusKm: 3 }, sort: 'distance', order: 'asc' });

        expect(namesOf(result)).toEqual(inOrder('R1', 'R5', 'R2', 'R3'));
      });

      it('applies the other filters to the restaurants around the point', async () => {
        const result = await list({
          near: { ...P, radiusKm: 25 },
          cuisines: ['South Indian'],
          sort: 'distance',
          order: 'asc',
        });

        // R6 serves South Indian too, but has no coordinates.
        expect(namesOf(result)).toEqual(inOrder('R1', 'R2', 'R3'));
      });

      it('applies the words of a free-text search to the restaurants around the point', async () => {
        const result = await list({
          near: { ...P, radiusKm: 25 },
          textWords: ['dosa'],
          sort: 'distance',
          order: 'asc',
        });

        // R3 ("Dosa Plaza & Co") is 2 km away; the neighbour tenant's "Neighbour Dosa" is at the point but not visible.
        expect(namesOf(result)).toEqual(inOrder('R1', 'R3'));

        // A word that only the locality has.
        const golf = await list({ near, sort: 'distance', order: 'asc', textWords: ['golf'] });
        expect(namesOf(golf)).toEqual(inOrder('R4'));
      });

      it('can order the restaurants around the point some other way and still report the distance', async () => {
        const result = await list({ near: { ...P, radiusKm: 3 }, sort: 'rating', order: 'desc' });

        expect(namesOf(result)).toEqual(inOrder('R1', 'R2', 'R3', 'R5'));
        expect(result.items.map((item) => item.distanceKm)).toEqual([0, 1, 1.96, 0.11]);

        const byName = await list({ near: { ...P, radiusKm: 3 }, sort: 'name', order: 'asc' });
        expect(namesOf(byName)).toEqual(inOrder('R2', 'R1', 'R3', 'R5'));
        expect(byName.items.every((item) => item.distanceKm !== undefined)).toBe(true);
      });

      it('pages through the restaurants by distance', async () => {
        const pages = [];
        for (const offset of [0, 2, 4]) {
          pages.push(await list({ near, sort: 'distance', order: 'asc', limit: 2, offset }));
        }

        expect(pages.map(namesOf)).toEqual([
          inOrder('R1', 'R5'),
          inOrder('R2', 'R3'),
          inOrder('R4', 'R7'),
        ]);
        expect(pages.map((page) => page.hasMore)).toEqual([true, true, true]);
        expect((await list({ near, sort: 'distance', order: 'asc', limit: 2, offset: 10 })).hasMore).toBe(false);
      });

      it('never shows the inactive restaurant or the other tenant\'s restaurant standing at the point', async () => {
        const result = await list({ near: { ...P, radiusKm: 0.05 }, sort: 'distance', order: 'asc' });

        expect(namesOf(result)).toEqual(inOrder('R1'));
      });
    });

    describe('vocabulary', () => {
      it('counts the cities and cuisines of the active restaurants, in character order', async () => {
        const vocabulary = await store.vocabulary(tenant);

        expect(vocabulary.cities).toEqual([
          { name: 'Gurgaon', count: 6 },
          { name: 'Mumbai', count: 2 },
          { name: 'New Delhi', count: 2 },
          { name: 'New York', count: 2 },
        ]);
        expect(vocabulary.cuisines).toEqual([
          { name: 'American', count: 2 },
          { name: 'Bar Food', count: 1 },
          { name: 'Burger', count: 1 },
          { name: 'Cafe', count: 2 },
          { name: 'Chinese', count: 2 },
          { name: 'Fast Food', count: 2 },
          { name: 'Mughlai', count: 2 },
          { name: 'North Indian', count: 2 },
          { name: 'South Indian', count: 4 },
          { name: 'Steak', count: 1 },
          { name: 'Street Food', count: 2 },
        ]);
      });

      it('is empty for a tenant without restaurants', async () => {
        expect(await store.vocabulary(freshTenant('empty'))).toEqual({ cities: [], cuisines: [] });
      });

      it("does not count another tenant's restaurants", async () => {
        const neighbour = freshTenant('neighbour-vocabulary');
        await store.insert(aRestaurantDocument(neighbour, { cuisines: ['Thai'] }));

        expect(await store.vocabulary(neighbour)).toEqual({
          cities: [{ name: 'Gurgaon', count: 1 }],
          cuisines: [{ name: 'Thai', count: 1 }],
        });
      });
    });
  });
}
