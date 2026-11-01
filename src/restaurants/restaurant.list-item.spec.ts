import { toListItem } from './restaurant.list-item';
import type { ListedRestaurant } from './restaurant.store';

const listed = (extra: Partial<ListedRestaurant> = {}): ListedRestaurant => ({
  id: 'a'.repeat(24),
  doc: {
    name: 'Naivedhyam',
    address: {
      line: '12 Main Road',
      locality: 'Sector 29',
      city: 'Gurgaon',
      country: { code: 'IN', name: 'India' },
    },
    cuisines: ['South Indian', 'Vegetarian'],
    cost: { forTwo: 800, currency: 'INR', priceRange: 2 },
    rating: { average: 4.3, votes: 4385, label: 'Very Good', score: 4.2903 },
  },
  ...extra,
});

describe('toListItem', () => {
  it('has the attributes the brief asks for, and a few more for a restaurant card', () => {
    expect(toListItem(listed())).toEqual({
      id: 'a'.repeat(24),
      name: 'Naivedhyam',
      address: '12 Main Road',
      locality: 'Sector 29',
      city: 'Gurgaon',
      country: 'India',
      countryCode: 'IN',
      cuisines: ['South Indian', 'Vegetarian'],
      averageRating: 4.3,
      votes: 4385,
      costForTwo: 800,
      currency: 'INR',
    });
  });

  it('adds the distance only when the row has one', () => {
    expect(toListItem(listed({ distanceKm: 1.96 }))).toHaveProperty('distanceKm', 1.96);
    expect(toListItem(listed({ distanceKm: 0 }))).toHaveProperty('distanceKm', 0);
    expect(toListItem(listed())).not.toHaveProperty('distanceKm');
  });

  it('shows the average the customers gave, not the weighted score used for sorting', () => {
    const item = toListItem(listed());

    expect(item.averageRating).toBe(4.3);
    expect(item).not.toHaveProperty('score');
    expect(item).not.toHaveProperty('rating');
  });

  it('maps a restaurant nobody rated and priced to nulls and zero votes', () => {
    const { doc } = listed();
    const item = toListItem({
      id: 'b'.repeat(24),
      doc: {
        ...doc,
        rating: { average: null, votes: 0, label: null, score: null },
        cost: { forTwo: null, currency: 'INR', priceRange: null },
      },
    });

    expect(item).toMatchObject({ averageRating: null, votes: 0, costForTwo: null, currency: 'INR' });
  });

  it('maps a document without rating and cost, as another writer may have stored it', () => {
    const { doc } = listed();
    const { rating: _rating, cost: _cost, ...bare } = doc;

    expect(toListItem({ id: 'c'.repeat(24), doc: bare })).toMatchObject({
      averageRating: null,
      votes: 0,
      costForTwo: null,
      currency: null,
    });
  });

  it('keeps a missing street line and locality as null', () => {
    const { doc } = listed();
    const item = toListItem({
      id: 'd'.repeat(24),
      doc: { ...doc, address: { ...doc.address, line: null, locality: null } },
    });

    expect(item).toMatchObject({ address: null, locality: null });
  });
});
