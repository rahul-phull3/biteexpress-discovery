import { InMemoryRestaurantStore } from './in-memory-restaurant-store';
import {
  aRestaurantDocument,
  describeRestaurantStoreContract,
} from './restaurant-store.contract';

// The same checks run against MongoDB in test/restaurants.int-spec.ts.
describeRestaurantStoreContract(
  'InMemoryRestaurantStore',
  () => new InMemoryRestaurantStore(),
);

describe('InMemoryRestaurantStore', () => {
  it('keeps its own copy, so editing what was inserted does not change the stored restaurant', async () => {
    const store = new InMemoryRestaurantStore();
    const doc = aRestaurantDocument('t1');
    const { id } = await store.insert(doc);

    doc.name = 'Changed afterwards';
    doc.cuisines.push('Added afterwards');

    const found = await store.findById('t1', id);
    expect(found?.doc.name).toBe('Naivedhyam');
    expect(found?.doc.cuisines).toEqual(['South Indian', 'Vegetarian']);
  });

  it('counts the restaurants of one tenant', async () => {
    const store = new InMemoryRestaurantStore();
    await store.insert(aRestaurantDocument('a'));
    await store.insert(aRestaurantDocument('a'));
    await store.insert(aRestaurantDocument('b'));

    expect(store.countFor('a')).toBe(2);
    expect(store.countFor('b')).toBe(1);
    expect(store.countFor('c')).toBe(0);
  });
});
