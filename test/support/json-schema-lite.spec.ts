import type { AnyBulkWriteOperation, Document } from 'mongodb';
import { restaurantValidator } from '../../src/database/restaurants.collection';
import {
  containsUndefined,
  documentFromUpsert,
  schemaViolations,
} from './json-schema-lite';

// These tests check the checker. The sample-data spec relies on it to say "the
// database would accept this document", so it must also say "no" when it should.

const schema = restaurantValidator.$jsonSchema;

/** A document the real validator accepts. */
function validDocument(): Document {
  const now = new Date();
  return {
    tenantId: 'biteexpress',
    schemaVersion: 1,
    source: { system: 'zomato', id: '308022' },
    name: 'Farzi Cafe',
    address: {
      line: '7-8, Cyber Hub',
      locality: null,
      city: 'Gurgaon',
      country: { code: 'IN', name: 'India' },
    },
    location: { type: 'Point', coordinates: [77.0886879, 28.4952079] },
    cuisines: ['Modern Indian'],
    cost: { forTwo: 2200, currency: 'INR', priceRange: 4 },
    rating: { average: 4.3, votes: 4385, label: 'Very Good', score: 4.2903 },
    services: {
      tableBooking: false,
      onlineDelivery: false,
      deliveringNow: false,
    },
    status: 'active',
    dataQuality: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('schemaViolations', () => {
  it('accepts a valid restaurant', () => {
    expect(schemaViolations(schema, validDocument())).toEqual([]);
  });

  it('accepts a restaurant without a location or a source, which are optional', () => {
    const { location: _location, source: _source, ...rest } = validDocument();

    expect(schemaViolations(schema, rest)).toEqual([]);
  });

  it('accepts extra fields, as the validator does', () => {
    expect(
      schemaViolations(schema, {
        ...validDocument(),
        favouriteDish: 'Vada Pav',
      }),
    ).toEqual([]);
  });

  it('names a required field that is missing', () => {
    const { tenantId: _tenantId, ...rest } = validDocument();

    expect(schemaViolations(schema, rest)).toEqual(['tenantId: is required']);
  });

  it('checks types, and tells a whole number from a decimal as BSON does', () => {
    const problems = schemaViolations(schema, {
      ...validDocument(),
      schemaVersion: 1.5, // must be an int or long
      name: 42,
    });

    expect(problems).toEqual([
      'schemaVersion: expected int or long, got double 1.5',
      'name: expected string, got number 42',
    ]);
  });

  it('checks lengths, patterns and enums', () => {
    const document = validDocument();
    document.name = 'x'.repeat(201);
    document.address.country.code = 'in';
    document.status = 'archived';

    const problems = schemaViolations(schema, document);

    expect(problems).toContain('name: longer than 200 characters');
    expect(problems).toContain(
      'address.country.code: "in" does not match ^[A-Z]{2}$',
    );
    expect(
      problems.some((p) => p.startsWith('status: "archived" is not one of')),
    ).toBe(true);
  });

  it('checks the ranges of numbers and of coordinates, position by position', () => {
    const document = validDocument();
    document.rating.average = 5.5;
    document.cost.priceRange = 5;
    document.location.coordinates = [200, 95];

    const problems = schemaViolations(schema, document);

    expect(problems).toContain('rating.average: 5.5 is above 5');
    expect(problems).toContain('cost.priceRange: 5 is above 4');
    expect(problems).toContain('location.coordinates[0]: 200 is above 180');
    expect(problems).toContain('location.coordinates[1]: 95 is above 90');
  });

  it('checks the items of an array', () => {
    const document = validDocument();
    document.cuisines = ['Cafe', ''];

    expect(schemaViolations(schema, document)).toEqual([
      'cuisines[1]: shorter than 1 characters',
    ]);
  });

  it('allows null where the validator allows it and refuses it elsewhere', () => {
    const allowed = validDocument();
    allowed.address.line = null;
    allowed.cost.forTwo = null;
    const refused = { ...validDocument(), name: null };

    expect(schemaViolations(schema, allowed)).toEqual([]);
    expect(schemaViolations(schema, refused)).toEqual([
      'name: expected string, got null',
    ]);
  });

  it('refuses a date field that holds text', () => {
    expect(
      schemaViolations(schema, { ...validDocument(), createdAt: '2026-10-30' }),
    ).toEqual(['createdAt: expected date, got string "2026-10-30"']);
  });
});

describe('documentFromUpsert', () => {
  const operation: AnyBulkWriteOperation<Document> = {
    updateOne: {
      filter: { tenantId: 'acme', 'source.system': 'zomato', 'source.id': '1' },
      update: {
        $set: {
          name: 'Cafe',
          updatedAt: new Date(0),
          location: { type: 'Point' },
        },
        $setOnInsert: { createdAt: new Date(0) },
        $unset: { location: '' },
      },
      upsert: true,
    },
  };

  it('builds the inserted document from the filter and the operators', () => {
    const document = documentFromUpsert(operation);

    expect(document).toEqual({
      tenantId: 'acme',
      source: { system: 'zomato', id: '1' },
      name: 'Cafe',
      updatedAt: new Date(0),
      createdAt: new Date(0),
    });
  });

  it('refuses an operation that is not an updateOne', () => {
    expect(() => documentFromUpsert({ deleteOne: { filter: {} } })).toThrow(
      'expected an updateOne',
    );
  });
});

describe('containsUndefined', () => {
  it('finds an undefined value anywhere', () => {
    expect(containsUndefined({ a: { b: [1, undefined] } })).toBe(true);
    expect(containsUndefined({ a: undefined })).toBe(true);
  });

  it('is false when nothing is undefined, including for null and empty values', () => {
    expect(
      containsUndefined({ a: null, b: [], c: {}, d: new Date(0), e: '' }),
    ).toBe(false);
  });
});
