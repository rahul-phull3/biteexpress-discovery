import {
  RESTAURANT_INDEX_NAMES,
  RESTAURANT_INDEXES,
  restaurantValidator,
} from './restaurants.collection';

describe('restaurants collection definition', () => {
  it('starts every index with tenantId, so one tenant never scans another', () => {
    for (const index of RESTAURANT_INDEXES) {
      expect(Object.keys(index.key)[0]).toBe('tenantId');
    }
  });

  it('gives every index a unique name', () => {
    expect(RESTAURANT_INDEX_NAMES).toHaveLength(RESTAURANT_INDEXES.length);
    expect(new Set(RESTAURANT_INDEX_NAMES).size).toBe(
      RESTAURANT_INDEXES.length,
    );
  });

  it('keeps the unique source index partial, so restaurants without a source do not collide', () => {
    const unique = RESTAURANT_INDEXES.filter((index) => index.unique);

    expect(unique).toHaveLength(1);
    expect(unique[0].name).toBe('tenant_source_unique');
    expect(unique[0].partialFilterExpression).toEqual({
      'source.system': { $exists: true },
      'source.id': { $exists: true },
    });
  });

  it('requires the fields that every query and index relies on', () => {
    const required: string[] = restaurantValidator.$jsonSchema.required;

    for (const field of [
      'tenantId',
      'schemaVersion',
      'name',
      'address',
      'status',
    ]) {
      expect(required).toContain(field);
    }
  });

  it('does not forbid extra fields, so a newer app version can add one', () => {
    expect(restaurantValidator.$jsonSchema.additionalProperties).toBe(
      undefined,
    );
  });
});
