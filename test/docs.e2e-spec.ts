import type { INestApplication } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import request from 'supertest';
import { QueryTimeoutError } from '../src/database/query-timeout.error';
import {
  RESTAURANT_INDEX_NAMES,
  SEARCH_INDEX_NAME,
} from '../src/database/restaurants.collection';
import { buildOpenApiDocument } from '../src/docs/openapi.document';
import type { RestaurantStore } from '../src/restaurants/restaurant.store';
import { FakeDb } from './support/fake-db';
import { InMemoryRestaurantStore } from './support/in-memory-restaurant-store';
import { createAppWithFakeMongo } from './support/test-app';

// The OpenAPI document is the contract that Swagger shows and Postman imports.
// This file calls the running API, with the real controllers and no database,
// and checks every answer against that contract: the status code is one the
// document lists for the operation, the body fits the schema the document names
// for it, and every header the document promises is there. A route that starts
// answering something the document does not say fails here.
// src/docs/openapi.document.spec.ts checks the other direction (the request side).

type Obj = Record<string, any>;

const contract = buildOpenApiDocument();
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = new Map<string, ValidateFunction>();

/** What the checks read of a response. */
interface Answer {
  status: number;
  body: unknown;
  headers: Record<string, string | undefined>;
}

/** Follows a reference such as "#/components/headers/RequestId" inside the contract. */
function follow(node: Obj): Obj {
  if (typeof node.$ref !== 'string') return node;
  return follow(
    node.$ref
      .slice(2)
      .split('/')
      .reduce((target: Obj, key: string) => target[key], contract),
  );
}

function expectSchema(schema: Obj, body: unknown): void {
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    // The schema refers to #/components/..., so the components travel with it.
    validate = ajv.compile({ ...schema, components: contract.components });
    validators.set(key, validate);
  }
  const valid = validate(body);
  expect({ valid, errors: valid ? [] : validate.errors }).toEqual({ valid: true, errors: [] });
}

/** The answer is one that the contract promises for this operation: status, body and headers. */
function expectDocumented(path: string, method: 'get' | 'post', answer: Answer): void {
  const operation = contract.paths[path][method] as Obj;
  const listed = Object.keys(operation.responses as Obj);
  if (!listed.includes(String(answer.status))) {
    throw new Error(
      `${method.toUpperCase()} ${path} answered ${answer.status}, but the document lists only ${listed.join(', ')}.`,
    );
  }
  const promised = follow(operation.responses[String(answer.status)]);

  for (const [name, header] of Object.entries<Obj>(promised.headers ?? {})) {
    const value = answer.headers[name.toLowerCase()];
    expect({ header: name, sent: value !== undefined }).toEqual({ header: name, sent: true });
    const allowed = follow(header).schema?.enum as string[] | undefined;
    if (allowed) expect(allowed).toContain(value);
  }

  const [mediaType, media] = Object.entries<Obj>(promised.content ?? {})[0] ?? [];
  if (mediaType && media) {
    expect(String(answer.headers['content-type'])).toContain(mediaType);
    expectSchema(media.schema, answer.body);
  }
}

const PROBLEM_TYPE = {
  validation: '/problems/validation-error',
  notFound: '/problems/not-found',
  conflict: '/problems/conflict',
  unavailable: '/problems/service-unavailable',
};

const inGurgaon = { city: 'Gurgaon', countryCode: 'IN' };

const naivedhyam = {
  name: 'Naivedhyam',
  address: { line: '12 Main Road', locality: 'Sector 29', ...inGurgaon },
  location: { latitude: 28.4595, longitude: 77.0266 },
  cuisines: ['South Indian', 'Vegetarian'],
  cost: { forTwo: 800, priceRange: 2 },
  rating: { average: 4.3, votes: 4385 },
  services: { onlineDelivery: true },
  source: { system: 'zomato', id: '18200' },
};

const zambar = {
  name: 'Zambar',
  address: inGurgaon,
  location: { latitude: 28.495, longitude: 77.089 },
  cuisines: ['South Indian'],
  cost: { forTwo: 1200, priceRange: 3 },
  rating: { average: 4.0, votes: 802 },
};

describe('the OpenAPI document and the API it describes (e2e)', () => {
  let app: INestApplication;
  const tenant = 'docs-e2e';
  let savedId = '';

  beforeAll(async () => {
    app = await createAppWithFakeMongo(
      new FakeDb({
        indexNames: ['_id_', ...RESTAURANT_INDEX_NAMES],
        searchIndexes: [{ name: SEARCH_INDEX_NAME, status: 'READY', queryable: true }],
      }),
      { restaurantStore: new InMemoryRestaurantStore(), docs: true },
    );
    const created = await request(app.getHttpServer())
      .post('/v1/restaurants')
      .set('X-Tenant-Id', tenant)
      .send(naivedhyam)
      .expect(201);
    savedId = (created.body as { id: string }).id;
    await request(app.getHttpServer()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(zambar).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('serving the contract', () => {
    it('serves the Swagger UI at /docs', async () => {
      const res = await request(server()).get('/docs').expect(200);

      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('swagger-ui');
    });

    it('serves the document as JSON, the file that Postman imports', async () => {
      const res = await request(server()).get('/docs/openapi.json').expect(200);

      expect(res.body).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
    });

    it('serves the document as YAML too', async () => {
      const res = await request(server()).get('/docs/openapi.yaml').expect(200);

      expect(res.text).toContain('openapi: 3.1.0');
    });

    it('keeps the documentation outside the /v1 prefix, like the probes', async () => {
      await request(server()).get('/v1/docs/openapi.json').expect(404);
    });
  });

  describe('the probes', () => {
    it('GET /health answers as documented', async () => {
      const res = await request(server()).get('/health').expect(200);

      expectDocumented('/health', 'get', res);
    });

    it('GET /ready answers as documented when it is ready', async () => {
      const res = await request(server()).get('/ready').expect(200);

      expectDocumented('/ready', 'get', res);
    });

    it('GET /ready answers as documented when it is not', async () => {
      const down = await createAppWithFakeMongo(new FakeDb({ pingError: new Error('connection refused') }));
      try {
        const res = await request(down.getHttpServer()).get('/ready').expect(503);

        expectDocumented('/ready', 'get', res);
      } finally {
        await down.close();
      }
    });
  });

  describe('POST /v1/restaurants', () => {
    it('answers 201 as documented, for the smallest body and for a full one', async () => {
      for (const body of [{ name: 'Dosa Corner', address: inGurgaon }, { ...zambar, source: { system: 'zomato', id: '7' } }]) {
        const res = await request(server()).post('/v1/restaurants').set('X-Tenant-Id', 'docs-e2e-new').send(body).expect(201);

        expectDocumented('/v1/restaurants', 'post', res);
      }
    });

    it('answers 400 as documented, with one error per faulty field', async () => {
      const res = await request(server())
        .post('/v1/restaurants')
        .set('X-Tenant-Id', tenant)
        .send({ name: '', address: { city: 'Gurgaon', countryCode: 'XX' }, rating: { average: 9 } })
        .expect(400);

      expectDocumented('/v1/restaurants', 'post', res);
      expect(res.body).toMatchObject({ type: PROBLEM_TYPE.validation });
      expect((res.body as { errors: unknown[] }).errors.length).toBeGreaterThanOrEqual(3);
    });

    it('answers 400 as documented for an invalid X-Tenant-Id', async () => {
      const res = await request(server()).post('/v1/restaurants').set('X-Tenant-Id', 'not valid!').send(zambar).expect(400);

      expectDocumented('/v1/restaurants', 'post', res);
    });

    it('answers 409 as documented when the tenant already has the source', async () => {
      const res = await request(server()).post('/v1/restaurants').set('X-Tenant-Id', tenant).send(naivedhyam).expect(409);

      expectDocumented('/v1/restaurants', 'post', res);
      expect(res.body).toMatchObject({ type: PROBLEM_TYPE.conflict });
    });
  });

  describe('GET /v1/restaurants/{id}', () => {
    it('answers 200 as documented, and 304 for a repeat that sends the ETag back', async () => {
      const path = `/v1/restaurants/${savedId}`;
      const first = await request(server()).get(path).set('X-Tenant-Id', tenant).expect(200);
      expectDocumented('/v1/restaurants/{id}', 'get', first);

      const again = await request(server())
        .get(path)
        .set('X-Tenant-Id', tenant)
        .set('If-None-Match', first.headers.etag as string)
        .expect(304);
      expectDocumented('/v1/restaurants/{id}', 'get', again);
    });

    it('answers 404 as documented for an id that does not exist, and for another tenant', async () => {
      for (const [id, asTenant] of [['f'.repeat(24), tenant], [savedId, 'someone-else']] as const) {
        const res = await request(server()).get(`/v1/restaurants/${id}`).set('X-Tenant-Id', asTenant).expect(404);

        expectDocumented('/v1/restaurants/{id}', 'get', res);
        expect(res.body).toMatchObject({ type: PROBLEM_TYPE.notFound });
      }
    });

    it('answers 400 as documented for a malformed id', async () => {
      const res = await request(server()).get('/v1/restaurants/not-an-id').set('X-Tenant-Id', tenant).expect(400);

      expectDocumented('/v1/restaurants/{id}', 'get', res);
    });
  });

  describe('GET /v1/restaurants', () => {
    it('answers 200 as documented', async () => {
      const res = await request(server()).get('/v1/restaurants').set('X-Tenant-Id', tenant).expect(200);

      expectDocumented('/v1/restaurants', 'get', res);
      expect((res.body as { data: unknown[] }).data).toHaveLength(2);
    });

    it('describes the distance when the request has a point', async () => {
      const res = await request(server())
        .get('/v1/restaurants')
        .query({ lat: 28.495, lng: 77.089, radiusKm: 10 })
        .set('X-Tenant-Id', tenant)
        .expect(200);

      expectDocumented('/v1/restaurants', 'get', res);
      expect((res.body as { data: Array<{ distanceKm?: number }> }).data[0]?.distanceKm).toBe(0);
    });

    it('answers 400 as documented for a parameter that does not exist', async () => {
      const res = await request(server()).get('/v1/restaurants?citty=Gurgaon').set('X-Tenant-Id', tenant).expect(400);

      expectDocumented('/v1/restaurants', 'get', res);
    });
  });

  describe('GET /v1/restaurants/search', () => {
    it.each([
      'Best restaurants in Gurgaon with South Indian Food',
      'Restaurants in Gurgaon under Rs. 1000 for two',
      'Nearest place that serves Vada Pav',
    ])('answers 200 as documented for "%s"', async (q) => {
      const res = await request(server()).get('/v1/restaurants/search').query({ q, lat: 28.495, lng: 77.089 }).set('X-Tenant-Id', tenant).expect(200);

      expectDocumented('/v1/restaurants/search', 'get', res);
    });

    it('answers 400 as documented for a sentence that is too long', async () => {
      const res = await request(server()).get('/v1/restaurants/search').query({ q: 'a'.repeat(201) }).set('X-Tenant-Id', tenant).expect(400);

      expectDocumented('/v1/restaurants/search', 'get', res);
    });
  });

  describe('a read that ran past its time limit', () => {
    const timingOut: RestaurantStore = {
      insert: async () => {
        throw new QueryTimeoutError(2000);
      },
      findById: async () => {
        throw new QueryTimeoutError(2000);
      },
      list: async () => {
        throw new QueryTimeoutError(2000);
      },
      vocabulary: async () => ({ cities: [], cuisines: [] }),
    };
    let slow: INestApplication;

    beforeAll(async () => {
      slow = await createAppWithFakeMongo(new FakeDb(), { restaurantStore: timingOut });
    });

    afterAll(async () => {
      await slow.close();
    });

    it.each([
      { url: `/v1/restaurants/${'a'.repeat(24)}`, path: '/v1/restaurants/{id}' },
      { url: '/v1/restaurants?city=Gurgaon', path: '/v1/restaurants' },
      { url: '/v1/restaurants/search?q=pizza', path: '/v1/restaurants/search' },
    ])('answers 503 with Retry-After on GET $url, as documented', async ({ url, path }) => {
      const res = await request(slow.getHttpServer()).get(url).expect(503);

      expect(res.headers['retry-after']).toBe('1');
      expect(res.body).toMatchObject({ type: PROBLEM_TYPE.unavailable, status: 503 });
      expectDocumented(path, 'get', res);
    });
  });
});
