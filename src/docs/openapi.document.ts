import { API_PREFIX } from '../http/api-prefix';
import { NAME_MAX_LENGTH } from '../importer/clean-row';
import {
  DEFAULT_LIMIT,
  MAX_COST,
  MAX_LIMIT,
  MAX_OFFSET,
  MAX_RADIUS_KM,
  MAX_SEARCH_TEXT,
} from '../restaurants/list-query.schema';
import { LIST_SORTS } from '../restaurants/list-sort';
import { supportedCountryCodes } from '../restaurants/supported-countries';

/**
 * The contract of the API as an OpenAPI 3.1 document, served at
 * /docs/openapi.json and shown by the Swagger UI at /docs.
 *
 * It is written by hand, on purpose. The request schemas are Zod schemas with
 * transforms, defaults and cross-field rules; a generator would turn those into
 * a lossy guess. Two kinds of test keep this document honest instead:
 *  - openapi.document.spec.ts: the parameters and the request body it lists are
 *    exactly the ones the Zod schemas accept;
 *  - test/docs.e2e-spec.ts: every answer the running app gives, errors included,
 *    validates against the schema this document promises for it.
 * The numbers (limits, maximums) are imported from the schemas, not retyped.
 */

/** A JSON-shaped value. The document is plain data; no library types are needed. */
type Obj = Record<string, any>;

const ref = (kind: 'schemas' | 'responses' | 'parameters' | 'headers', name: string): Obj => ({
  $ref: `#/components/${kind}/${name}`,
});

const STRING_OR_NULL = ['string', 'null'];
const NUMBER_OR_NULL = ['number', 'null'];
const INTEGER_OR_NULL = ['integer', 'null'];
const HEX_ID = '^[0-9a-f]{24}$';
const TENANT_PATTERN = '^[A-Za-z0-9_-]{1,64}$';

/** The parameters GET /v1/restaurants and GET /v1/restaurants/search share. */
function listParameters(): Obj[] {
  const query = (name: string, schema: Obj, description: string): Obj => ({
    name,
    in: 'query',
    required: false,
    description,
    schema,
  });
  return [
    query('name', { type: 'string', maxLength: 100 }, 'The name contains this text (any letter case, taken literally).'),
    query(
      'city',
      { type: 'string', maxLength: 100 },
      'A city, in any letter case. Other names are understood: `Gurugram` for `Gurgaon`, `Bengaluru` for `Bangalore`.',
    ),
    query(
      'country',
      { type: 'string', maxLength: 60 },
      'A country name or an ISO 3166-1 alpha-2 code: `India`, `IN`, `UK`, `USA`.',
    ),
    query(
      'cuisine',
      { type: 'string', maxLength: 1200 },
      'One cuisine or several, separated by commas (`Thai,Chinese`), or repeat the parameter. At most 20. A restaurant matches when it serves any of them; see `cuisineMatch`.',
    ),
    query(
      'cuisineMatch',
      { type: 'string', enum: ['any', 'all'], default: 'any' },
      'With several cuisines: `any` of them, or `all` of them.',
    ),
    query('minRating', { type: 'number', minimum: 0, maximum: 5 }, 'The plain average rating is at least this. A restaurant nobody rated never matches.'),
    query('minCost', { type: 'integer', minimum: 0, maximum: MAX_COST }, 'The average cost for two is at least this, in one currency. An unknown cost never matches.'),
    query('maxCost', { type: 'integer', minimum: 0, maximum: MAX_COST }, 'The average cost for two is at most this, in one currency. An unknown cost never matches.'),
    query(
      'currency',
      { type: 'string', pattern: '^[A-Za-z]{3}$' },
      'The ISO 4217 code of the currency of the cost filters, such as `INR`. Costs are never converted between currencies.',
    ),
    query('priceRange', { type: 'integer', minimum: 1, maximum: 4 }, 'The price band, 1 (cheap) to 4 (expensive).'),
    query('delivery', { type: 'boolean' }, 'Offers online delivery (`true`) or not (`false`).'),
    query('booking', { type: 'boolean' }, 'Offers table booking (`true`) or not (`false`).'),
    query(
      'lat',
      { type: 'number', minimum: -90, maximum: 90 },
      'Latitude of the point to measure distance from. Needs `lng`. Every item then has `distanceKm`, and the default sort is `distance`.',
    ),
    query('lng', { type: 'number', minimum: -180, maximum: 180 }, 'Longitude of the point to measure distance from. Needs `lat`.'),
    query(
      'radiusKm',
      { type: 'number', exclusiveMinimum: 0, maximum: MAX_RADIUS_KM },
      `Only restaurants at most this far from the point, in kilometres (at most ${MAX_RADIUS_KM}). Needs \`lat\` and \`lng\`.`,
    ),
    query(
      'sort',
      { type: 'string', enum: [...LIST_SORTS] },
      '`distance` (nearest first; needs `lat` and `lng`), `rating` (the weighted score, best first; the default without a point), `averageRating`, `votes`, `cost`, `name` or `city`.',
    ),
    query('order', { type: 'string', enum: ['asc', 'desc'] }, 'Reverses the default direction of the sort. `distance` can only be `asc`.'),
  ];
}

const limitParameter = (withDefault: boolean): Obj => ({
  name: 'limit',
  in: 'query',
  required: false,
  description: withDefault
    ? `The page size, 1 to ${MAX_LIMIT}.`
    : `The page size, 1 to ${MAX_LIMIT}. Without it the sentence may set one ("top 5"); otherwise ${DEFAULT_LIMIT}.`,
  schema: withDefault
    ? { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT }
    : { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
});

const offsetParameter: Obj = {
  name: 'offset',
  in: 'query',
  required: false,
  description: `How many restaurants to skip, 0 to ${MAX_OFFSET}. There is no total: \`page.hasMore\` says whether another page exists.`,
  schema: { type: 'integer', minimum: 0, maximum: MAX_OFFSET, default: 0 },
};

const queryParameter: Obj = {
  name: 'q',
  in: 'query',
  required: false,
  description:
    'A sentence, such as `Best restaurants in Gurgaon with South Indian Food`, `Restaurants in Gurgaon under Rs. 1000 for two` or `Nearest place that serves Vada Pav`. It is read into the parameters above; a parameter you send yourself wins over the sentence. The answer says how it was read (`interpretation`).',
  schema: { type: 'string', maxLength: MAX_SEARCH_TEXT },
};

/** The answers every operation can give, apart from its own success. */
const problemContent: Obj = { 'application/problem+json': { schema: ref('schemas', 'Problem') } };
const problemHeaders: Obj = {
  'X-Request-Id': ref('headers', 'RequestId'),
  'Cache-Control': {
    description: 'Always `no-store`: an error is never cached.',
    schema: { type: 'string', enum: ['no-store'] },
  },
};

const requestIdHeader = { 'X-Request-Id': ref('headers', 'RequestId') };

/** The probes are never cached. */
const noStoreHeader: Obj = {
  'Cache-Control': {
    description: 'Always `no-store`.',
    schema: { type: 'string', enum: ['no-store'] },
  },
};

const listSuccess = (schemaName: string, description: string): Obj => ({
  description,
  headers: {
    ...requestIdHeader,
    'Cache-Control': { description: 'The answer may be reused for 15 seconds, by the caller only.', schema: { type: 'string', enum: ['private, max-age=15'] } },
    Vary: { description: 'The answer depends on the tenant.', schema: { type: 'string', enum: ['X-Tenant-Id'] } },
  },
  content: { 'application/json': { schema: ref('schemas', schemaName) } },
});

const createExample = {
  name: 'Naivedhyam',
  address: { line: '12 Main Road', locality: 'Sector 29', city: 'Gurgaon', countryCode: 'IN' },
  location: { latitude: 28.4595, longitude: 77.0266 },
  cuisines: ['South Indian', 'Vegetarian'],
  cost: { forTwo: 800, priceRange: 2 },
  rating: { average: 4.3, votes: 4385 },
  services: { onlineDelivery: true },
};

const paths = (): Obj => ({
  [`/${API_PREFIX}/restaurants`]: {
    post: {
      tags: ['Restaurants'],
      operationId: 'createRestaurant',
      summary: 'Add a restaurant',
      description:
        'Creates a restaurant and returns it. The body is strict: a field this contract does not name is a 400. The server owns the id, the tenant, the currency, the rating label and score, the status, the data-quality flags and the timestamps. A `source` (system and id) that the tenant already has is a 409.',
      parameters: [ref('parameters', 'TenantId')],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: ref('schemas', 'CreateRestaurantRequest'),
            examples: {
              minimal: { summary: 'The least a restaurant needs', value: { name: 'Dosa Corner', address: { city: 'Gurgaon', countryCode: 'IN' } } },
              complete: { summary: 'A restaurant with everything', value: createExample },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Created. `Location` is the address of the new restaurant.',
          headers: {
            ...requestIdHeader,
            Location: { description: 'The address of the new restaurant.', schema: { type: 'string' } },
          },
          content: { 'application/json': { schema: ref('schemas', 'Restaurant') } },
        },
        '400': ref('responses', 'BadRequest'),
        '409': ref('responses', 'Conflict'),
        '500': ref('responses', 'InternalError'),
      },
    },
    get: {
      tags: ['Restaurants'],
      operationId: 'listRestaurants',
      summary: 'List and filter restaurants',
      description:
        'One page of the tenant\'s restaurants, filtered and sorted. Every parameter is optional; an unknown one is a 400, never ignored. Each item carries the attributes a restaurant card needs; the complete restaurant is one `GET /v1/restaurants/{id}` away.',
      parameters: [ref('parameters', 'TenantId'), ...listParameters(), limitParameter(true), offsetParameter],
      responses: {
        '200': listSuccess('ListResponse', 'One page of restaurants.'),
        '400': ref('responses', 'BadRequest'),
        '503': ref('responses', 'ServiceUnavailable'),
        '500': ref('responses', 'InternalError'),
      },
    },
  },
  [`/${API_PREFIX}/restaurants/search`]: {
    get: {
      tags: ['Restaurants'],
      operationId: 'searchRestaurants',
      summary: 'Search with a sentence',
      description:
        'Everything the list does, and `q`: a sentence read into the list\'s own parameters. The answer is a list plus `interpretation`, which says how the sentence was read: the parameters it turned into, the words left over, what the request overrode, and notes for every assumption. Words that are not a place or a filter go to Atlas Search when it is available (`interpretation.textSearch`).',
      parameters: [
        ref('parameters', 'TenantId'),
        queryParameter,
        ...listParameters(),
        limitParameter(false),
        offsetParameter,
      ],
      responses: {
        '200': listSuccess('SearchResponse', 'One page of restaurants and how the sentence was read.'),
        '400': ref('responses', 'BadRequest'),
        '503': ref('responses', 'ServiceUnavailable'),
        '500': ref('responses', 'InternalError'),
      },
    },
  },
  [`/${API_PREFIX}/restaurants/{id}`]: {
    get: {
      tags: ['Restaurants'],
      operationId: 'getRestaurant',
      summary: 'Get one restaurant',
      description:
        'The complete restaurant. A malformed id is a 400; an unknown id, or another tenant\'s, is a 404 (never a 403, which would confirm the id exists).',
      parameters: [
        ref('parameters', 'TenantId'),
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'The restaurant id: 24 hexadecimal characters.',
          schema: { type: 'string', pattern: HEX_ID },
        },
      ],
      responses: {
        '200': {
          description: 'The restaurant.',
          headers: {
            ...requestIdHeader,
            'Cache-Control': { description: 'The answer may be reused for 30 seconds, by the caller only.', schema: { type: 'string', enum: ['private, max-age=30'] } },
            Vary: { description: 'The answer depends on the tenant.', schema: { type: 'string', enum: ['X-Tenant-Id'] } },
            ETag: { description: 'Send it back as If-None-Match to get a body-less 304 while nothing changed.', schema: { type: 'string' } },
          },
          content: { 'application/json': { schema: ref('schemas', 'Restaurant') } },
        },
        '304': {
          description: 'Nothing changed since the `ETag` that was sent as `If-None-Match`. There is no body.',
        },
        '400': ref('responses', 'BadRequest'),
        '404': ref('responses', 'NotFound'),
        '503': ref('responses', 'ServiceUnavailable'),
        '500': ref('responses', 'InternalError'),
      },
    },
  },
  '/health': {
    get: {
      tags: ['Probes'],
      operationId: 'getHealth',
      summary: 'Liveness',
      description: 'Answers 200 while the process can serve requests. It never touches MongoDB, so a database blip does not get the container restarted.',
      responses: {
        '200': {
          description: 'The process is alive.',
          headers: noStoreHeader,
          content: { 'application/json': { schema: ref('schemas', 'Health') } },
        },
      },
    },
  },
  '/ready': {
    get: {
      tags: ['Probes'],
      operationId: 'getReadiness',
      summary: 'Readiness',
      description:
        'Can this instance serve traffic right now? 200 when MongoDB answers and all five indexes exist; otherwise 503 with the same report. The Atlas Search index is reported but never fails readiness.',
      responses: {
        '200': {
          description: 'Ready.',
          headers: noStoreHeader,
          content: { 'application/json': { schema: ref('schemas', 'Readiness') } },
        },
        '503': {
          description: 'Not ready; the report says why.',
          content: { 'application/json': { schema: ref('schemas', 'Readiness') } },
        },
      },
    },
  },
});

const schemas = (): Obj => {
  const object = (properties: Obj, required: string[] = []): Obj => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  const text = (maxLength?: number): Obj => ({ type: 'string', ...(maxLength ? { maxLength } : {}) });

  return {
    CreateRestaurantRequest: {
      ...object(
        {
          name: { type: 'string', minLength: 1, maxLength: NAME_MAX_LENGTH },
          address: object(
            {
              line: { type: STRING_OR_NULL, maxLength: 500 },
              locality: { type: STRING_OR_NULL, maxLength: 200 },
              city: text(100),
              countryCode: {
                type: 'string',
                pattern: '^[A-Za-z]{2}$',
                description: `ISO 3166-1 alpha-2 code of the country, in either letter case. Supported: ${supportedCountryCodes().join(', ')}.`,
              },
            },
            ['city', 'countryCode'],
          ),
          location: {
            ...object(
              {
                latitude: { type: 'number', minimum: -90, maximum: 90 },
                longitude: { type: 'number', minimum: -180, maximum: 180 },
              },
              ['latitude', 'longitude'],
            ),
            description: 'Leave it out when the coordinates are unknown. 0, 0 is refused, and so are coordinates outside India for an Indian restaurant.',
          },
          cuisines: { type: 'array', items: text(60), maxItems: 20, default: [] },
          cost: object({
            forTwo: { type: NUMBER_OR_NULL, exclusiveMinimum: 0, maximum: MAX_COST, description: 'Average cost for two. Leave it out when unknown.' },
            priceRange: { type: INTEGER_OR_NULL, minimum: 1, maximum: 4 },
          }),
          rating: object({
            average: { type: NUMBER_OR_NULL, exclusiveMinimum: 0, maximum: 5, description: 'Leave it out for a restaurant nobody has rated.' },
            votes: { type: 'integer', minimum: 0, maximum: 1_000_000_000, default: 0, description: 'At least 1 when `average` is given.' },
          }),
          services: object({
            tableBooking: { type: 'boolean', default: false },
            onlineDelivery: { type: 'boolean', default: false },
            deliveringNow: { type: 'boolean', default: false },
          }),
          source: {
            ...object(
              {
                system: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,39}$' },
                id: { type: 'string', minLength: 1, maxLength: 100 },
              },
              ['system', 'id'],
            ),
            description: 'The restaurant\'s identity in the system it came from. The tenant can have each pair once.',
          },
        },
        ['name', 'address'],
      ),
    },

    Restaurant: object(
      {
        id: { type: 'string', pattern: HEX_ID },
        source: object({ system: text(), id: text() }, ['system', 'id']),
        name: text(),
        address: object(
          {
            line: { type: STRING_OR_NULL },
            locality: { type: STRING_OR_NULL },
            city: text(),
            country: object({ code: text(), name: text() }, ['code', 'name']),
          },
          ['line', 'locality', 'city', 'country'],
        ),
        location: object({ latitude: { type: 'number' }, longitude: { type: 'number' } }, ['latitude', 'longitude']),
        cuisines: { type: 'array', items: text() },
        cost: object(
          { forTwo: { type: NUMBER_OR_NULL }, currency: { type: STRING_OR_NULL }, priceRange: { type: INTEGER_OR_NULL } },
          ['forTwo', 'currency', 'priceRange'],
        ),
        rating: object(
          {
            average: { type: NUMBER_OR_NULL, description: 'The plain average of the customers\' ratings; null for a restaurant nobody rated.' },
            votes: { type: 'integer' },
            label: { type: STRING_OR_NULL },
            score: { type: NUMBER_OR_NULL, description: 'The weighted score that "best" sorts by.' },
          },
          ['average', 'votes', 'label', 'score'],
        ),
        services: object(
          { tableBooking: { type: 'boolean' }, onlineDelivery: { type: 'boolean' }, deliveringNow: { type: 'boolean' } },
          ['tableBooking', 'onlineDelivery', 'deliveringNow'],
        ),
        status: { type: 'string', enum: ['active', 'inactive'] },
        dataQuality: { type: 'array', items: text(), description: 'Flags the importer raised, such as `coords_missing`.' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      ['id', 'name', 'address', 'cuisines', 'cost', 'rating', 'services', 'status', 'dataQuality', 'createdAt', 'updatedAt'],
    ),

    RestaurantListItem: object(
      {
        id: { type: 'string', pattern: HEX_ID },
        name: text(),
        address: { type: STRING_OR_NULL, description: 'The street line.' },
        locality: { type: STRING_OR_NULL },
        city: text(),
        country: { type: 'string', description: 'The name of the country.' },
        countryCode: text(),
        cuisines: { type: 'array', items: text() },
        averageRating: { type: NUMBER_OR_NULL, description: 'The plain average of the customers\' ratings, 0 to 5; null for a restaurant nobody rated.' },
        votes: { type: 'integer' },
        costForTwo: { type: NUMBER_OR_NULL },
        currency: { type: STRING_OR_NULL },
        distanceKm: { type: 'number', description: 'Kilometres from the requested point, to 10 metres. Only present when the request had `lat` and `lng`.' },
      },
      ['id', 'name', 'address', 'locality', 'city', 'country', 'countryCode', 'cuisines', 'averageRating', 'votes', 'costForTwo', 'currency'],
    ),

    ListData: { type: 'array', items: ref('schemas', 'RestaurantListItem') },

    PageInfo: object(
      {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        hasMore: { type: 'boolean', description: 'Whether another page follows. There is no total on purpose.' },
      },
      ['limit', 'offset', 'hasMore'],
    ),

    ListMeta: object(
      {
        sort: { type: 'string', enum: [...LIST_SORTS], description: 'The sort that was applied.' },
        order: { type: 'string', enum: ['asc', 'desc'] },
        tookMs: { type: 'integer' },
      },
      ['sort', 'order', 'tookMs'],
    ),

    ListResponse: object(
      { data: ref('schemas', 'ListData'), page: ref('schemas', 'PageInfo'), meta: ref('schemas', 'ListMeta') },
      ['data', 'page', 'meta'],
    ),

    SearchInterpretation: object(
      {
        q: { type: STRING_OR_NULL, description: 'The sentence as it was read; null when the request had none.' },
        summary: { type: 'string', description: 'The whole search in one line.' },
        filters: {
          type: 'object',
          additionalProperties: true,
          description: 'The parameters of `GET /v1/restaurants` that the sentence turned into. Send them yourself to get the same list without the sentence.',
        },
        words: { type: 'array', items: text(), description: 'Words that are none of the above. Each must match the name or the area.' },
        overridden: { type: 'array', items: text(), description: 'Parameters the request sent itself, which replaced what the sentence said.' },
        notes: { type: 'array', items: text(), description: 'What was assumed, ignored or cannot be answered, in plain words.' },
        textSearch: {
          ...object(
            {
              engine: { type: 'string', enum: ['atlas', 'rules'], description: 'How the words were matched.' },
              degraded: { type: 'boolean', description: 'True when Atlas Search was wanted but could not be used, so the words were matched by plain rules instead.' },
            },
            ['engine', 'degraded'],
          ),
          description: 'Present only when the search tried Atlas Search for the words.',
        },
      },
      ['q', 'summary', 'filters', 'words', 'overridden', 'notes'],
    ),

    SearchResponse: object(
      {
        data: ref('schemas', 'ListData'),
        page: ref('schemas', 'PageInfo'),
        meta: ref('schemas', 'ListMeta'),
        interpretation: ref('schemas', 'SearchInterpretation'),
      },
      ['data', 'page', 'meta', 'interpretation'],
    ),

    FieldError: object(
      {
        pointer: { type: 'string', description: 'A JSON Pointer (RFC 6901) to the faulty field of the body, as a URI fragment: `#/address/city`.' },
        parameter: { type: 'string', description: 'The faulty path, query or header parameter.' },
        detail: { type: 'string' },
      },
      ['detail'],
    ),

    Problem: {
      type: 'object',
      description: 'The error document of every failure (RFC 9457, `application/problem+json`).',
      properties: {
        type: { type: 'string', description: 'A stable name for the kind of problem, such as `/problems/validation-error`.' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        instance: { type: 'string', description: 'The path of the request that failed.' },
        requestId: { type: 'string', description: 'The X-Request-Id of the call: quote it to find the log lines.' },
        errors: { type: 'array', items: ref('schemas', 'FieldError') },
      },
      required: ['type', 'title', 'status'],
    },

    Health: object(
      {
        status: { type: 'string', enum: ['ok'] },
        uptimeSeconds: { type: 'integer' },
        timestamp: { type: 'string', format: 'date-time' },
      },
      ['status', 'uptimeSeconds', 'timestamp'],
    ),

    Readiness: object(
      {
        status: { type: 'string', enum: ['ready', 'unavailable'] },
        timestamp: { type: 'string', format: 'date-time' },
        mongodb: object(
          { status: { type: 'string', enum: ['up', 'down'] }, latencyMs: { type: 'integer' }, error: text() },
          ['status'],
        ),
        indexes: object(
          {
            status: { type: 'string', enum: ['ok', 'missing', 'unknown'] },
            present: { type: 'array', items: text() },
            missing: { type: 'array', items: text() },
            error: text(),
          },
          ['status', 'present', 'missing'],
        ),
        search: object(
          { index: text(), status: text(), queryable: { type: 'boolean' }, error: text() },
          ['index', 'status', 'queryable'],
        ),
      },
      ['status', 'timestamp', 'mongodb', 'indexes', 'search'],
    ),
  };
};

const components = (): Obj => ({
  parameters: {
    TenantId: {
      name: 'X-Tenant-Id',
      in: 'header',
      required: false,
      description:
        'The tenant the request acts for: 1 to 64 letters, digits, underscores or hyphens. Without it, the server\'s default tenant. This header is a demo of the tenant boundary, not security: in production the tenant comes from the caller\'s verified credential.',
      schema: { type: 'string', pattern: TENANT_PATTERN },
    },
  },
  headers: {
    RequestId: {
      description: 'The id of this call. Quote it to find its log lines. A caller\'s own `X-Request-Id` is kept when it is short and made of safe characters.',
      schema: { type: 'string' },
    },
  },
  responses: {
    BadRequest: {
      description: 'The request is not valid. `errors` names every faulty field or parameter, an unknown one included.',
      headers: problemHeaders,
      content: problemContent,
    },
    NotFound: {
      description: 'No restaurant of this tenant has that id.',
      headers: problemHeaders,
      content: problemContent,
    },
    Conflict: {
      description: 'The tenant already has a restaurant with that `source`.',
      headers: problemHeaders,
      content: problemContent,
    },
    ServiceUnavailable: {
      description: 'MongoDB did not answer within the time limit of a read (`READ_TIMEOUT_MS`, 2 seconds by default). Try again after `Retry-After`.',
      headers: {
        ...problemHeaders,
        'Retry-After': { description: 'Seconds to wait before trying again.', schema: { type: 'integer' } },
      },
      content: problemContent,
    },
    InternalError: {
      description: 'A bug. The body says nothing about it; quote `requestId` when you report it.',
      headers: problemHeaders,
      content: problemContent,
    },
  },
  schemas: schemas(),
});

export function buildOpenApiDocument(): Obj {
  return {
    openapi: '3.1.0',
    info: {
      title: 'BiteExpress restaurant discovery API',
      version: '1.0.0',
      description: [
        'Restaurant discovery on MongoDB: create, fetch, list, filter and search restaurants, including with a plain-English sentence.',
        '',
        '**Errors** are RFC 9457 `application/problem+json`, with the `requestId` of the call and one entry in `errors` per faulty field.',
        '**Tenant**: every query is scoped to one tenant, taken from the `X-Tenant-Id` header (a demo; see the header).',
        '**Paging**: `limit` and `offset`, and `page.hasMore` instead of a total.',
        '**Time limit**: every database read is stopped after `READ_TIMEOUT_MS`; the answer is then a 503 with `Retry-After`.',
        '',
        'This document is also served as JSON at `/docs/openapi.json` and as YAML at `/docs/openapi.yaml`; import either into Postman.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'This server' }],
    tags: [
      { name: 'Restaurants', description: 'Create, fetch, list and search restaurants.' },
      { name: 'Probes', description: 'Liveness and readiness, for the platform that runs the service.' },
    ],
    paths: paths(),
    components: components(),
  };
}
