import type { Document, IndexDescription } from 'mongodb';

/**
 * Everything MongoDB needs to know about the restaurants collection, written
 * as plain data. schema-bootstrap.ts applies it at startup; readiness.ts uses
 * the index names to check that it was applied.
 */
export const RESTAURANTS_COLLECTION = 'restaurants';
export const SEARCH_INDEX_NAME = 'restaurants_search';

/**
 * The fields of a search index listing that this app reads. The driver types
 * each row as just { name }, but the server also sends the build status.
 */
export interface SearchIndexInfo {
  name: string;
  /** PENDING or BUILDING while it is built, READY once it can answer queries. */
  status?: string;
  queryable?: boolean;
}

const nullableString = { bsonType: ['string', 'null'] };

/**
 * The database-side contract for a restaurant. It states what must always be
 * true (required fields, types, ranges, allowed values) and says nothing about
 * extra fields, so a newer version of the app can add an optional field without
 * the older version's validator rejecting it. The Zod schemas in the API are
 * the first line of defence; this is the backstop for any other writer.
 *
 * Numbers use bsonType "number" (int, long, double or decimal) except for the
 * counters that must be whole numbers.
 */
export const restaurantValidator: Document = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'tenantId',
      'schemaVersion',
      'name',
      'address',
      'cuisines',
      'services',
      'status',
      'dataQuality',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      tenantId: { bsonType: 'string', minLength: 1, maxLength: 64 },
      schemaVersion: { bsonType: ['int', 'long'], minimum: 1 },
      // Optional: restaurants created through the API have no legacy identity.
      source: {
        bsonType: 'object',
        required: ['system', 'id'],
        properties: {
          system: { bsonType: 'string', minLength: 1 },
          id: { bsonType: 'string', minLength: 1 },
        },
      },
      name: { bsonType: 'string', minLength: 1, maxLength: 200 },
      address: {
        bsonType: 'object',
        required: ['city'],
        properties: {
          line: nullableString,
          locality: nullableString,
          city: { bsonType: 'string', minLength: 1 },
          zipcode: nullableString,
          country: {
            bsonType: 'object',
            required: ['code'],
            properties: {
              code: { bsonType: 'string', pattern: '^[A-Z]{2}$' },
              name: nullableString,
            },
          },
        },
      },
      // Optional: left out when the source coordinates are unusable.
      // GeoJSON order is [longitude, latitude].
      location: {
        bsonType: 'object',
        required: ['type', 'coordinates'],
        properties: {
          type: { enum: ['Point'] },
          coordinates: {
            bsonType: 'array',
            minItems: 2,
            maxItems: 2,
            items: [
              { bsonType: 'number', minimum: -180, maximum: 180 },
              { bsonType: 'number', minimum: -90, maximum: 90 },
            ],
          },
        },
      },
      cuisines: {
        bsonType: 'array',
        items: { bsonType: 'string', minLength: 1 },
      },
      cost: {
        bsonType: 'object',
        properties: {
          forTwo: { bsonType: ['number', 'null'], minimum: 0 },
          currency: nullableString,
          priceRange: { bsonType: ['int', 'null'], minimum: 1, maximum: 4 },
        },
      },
      rating: {
        bsonType: 'object',
        properties: {
          average: { bsonType: ['number', 'null'], minimum: 0, maximum: 5 },
          votes: { bsonType: ['int', 'long', 'null'], minimum: 0 },
          label: nullableString,
          score: { bsonType: ['number', 'null'], minimum: 0, maximum: 5 },
        },
      },
      services: {
        bsonType: 'object',
        required: ['tableBooking', 'onlineDelivery', 'deliveringNow'],
        properties: {
          tableBooking: { bsonType: 'bool' },
          onlineDelivery: { bsonType: 'bool' },
          deliveringNow: { bsonType: 'bool' },
        },
      },
      media: {
        bsonType: 'object',
        properties: { imageUrl: nullableString, menuUrl: nullableString },
      },
      status: { enum: ['active', 'inactive'] },
      dataQuality: { bsonType: 'array', items: { bsonType: 'string' } },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
};

/**
 * Regular indexes. tenantId leads every one so a query for one tenant never
 * walks another tenant's entries. Each compound index follows equality, then
 * sort, then range. Names are explicit so the bootstrap is safe to repeat and
 * /ready can check for them.
 */
export const RESTAURANT_INDEXES: IndexDescription[] = [
  // $geoNear distance queries. The query option of $geoNear must include tenantId.
  {
    name: 'tenant_location_2dsphere',
    key: { tenantId: 1, location: '2dsphere' },
  },
  // City listing, best first. _id makes the sort total, so pages are stable.
  {
    name: 'tenant_city_score',
    key: { tenantId: 1, 'address.city': 1, 'rating.score': -1, _id: 1 },
  },
  // City plus cuisine, best first. cuisines is an array, so this index is multikey.
  {
    name: 'tenant_city_cuisine_score',
    key: {
      tenantId: 1,
      'address.city': 1,
      cuisines: 1,
      'rating.score': -1,
    },
  },
  // Best first across the whole tenant: the default listing, and any filter
  // that is not city or location (country, rating, price, delivery, ...).
  // MongoDB reads it in order and stops once the page is full.
  {
    name: 'tenant_score',
    key: { tenantId: 1, 'rating.score': -1, _id: 1 },
  },
  // Makes imports safe to re-run and powers lookup by legacy id. Partial, so
  // restaurants without a source do not collide on a missing value.
  {
    name: 'tenant_source_unique',
    key: { tenantId: 1, 'source.system': 1, 'source.id': 1 },
    unique: true,
    partialFilterExpression: {
      'source.system': { $exists: true },
      'source.id': { $exists: true },
    },
  },
];

export const RESTAURANT_INDEX_NAMES: string[] = RESTAURANT_INDEXES.flatMap(
  (index) => (index.name ? [index.name] : []),
);

/**
 * Baseline Atlas Search definition: static mapping, so only these fields are
 * indexed. It covers text search and type-ahead on name and locality, exact
 * filters on tenant, status, city and cuisine, numeric ranges, and geo. The
 * search step extends it with facets once the queries exist.
 */
export const restaurantsSearchDefinition: Document = {
  mappings: {
    dynamic: false,
    fields: {
      tenantId: { type: 'token' },
      status: { type: 'token' },
      name: [
        { type: 'string' },
        {
          type: 'autocomplete',
          tokenization: 'edgeGram',
          minGrams: 2,
          maxGrams: 15,
          foldDiacritics: true,
        },
      ],
      address: {
        type: 'document',
        fields: {
          city: { type: 'token' },
          locality: [
            { type: 'string' },
            {
              type: 'autocomplete',
              tokenization: 'edgeGram',
              minGrams: 2,
              maxGrams: 15,
              foldDiacritics: true,
            },
          ],
        },
      },
      cuisines: [{ type: 'string' }, { type: 'token' }],
      cost: { type: 'document', fields: { priceRange: { type: 'number' } } },
      rating: {
        type: 'document',
        fields: { average: { type: 'number' }, score: { type: 'number' } },
      },
      location: { type: 'geo' },
    },
  },
};
