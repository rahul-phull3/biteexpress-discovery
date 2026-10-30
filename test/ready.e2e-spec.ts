import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  RESTAURANT_INDEX_NAMES,
  SEARCH_INDEX_NAME,
} from '../src/database/restaurants.collection';
import type { ReadinessReport } from '../src/health/readiness';
import { FakeDb, serverError } from './support/fake-db';
import { createAppWithFakeMongo } from './support/test-app';

const allIndexes = ['_id_', ...RESTAURANT_INDEX_NAMES];

describe('GET /ready (e2e)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function serverWith(fake: FakeDb) {
    app = await createAppWithFakeMongo(fake);
    return app.getHttpServer();
  }

  it('returns 200 and lists the indexes when MongoDB answers and they all exist', async () => {
    const server = await serverWith(
      new FakeDb({
        indexNames: allIndexes,
        searchIndexes: [
          { name: SEARCH_INDEX_NAME, status: 'READY', queryable: true },
        ],
      }),
    );

    const res = await request(server).get('/ready').expect(200);
    const body = res.body as ReadinessReport;

    expect(body.status).toBe('ready');
    expect(body.mongodb.status).toBe('up');
    expect(body.indexes.missing).toEqual([]);
    expect(body.indexes.present).toContain('tenant_location_2dsphere');
    expect(body.search.status).toBe('READY');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('stays 200 when only the search index is unavailable', async () => {
    const server = await serverWith(
      new FakeDb({
        indexNames: allIndexes,
        searchIndexes: serverError(31082, 'search is not enabled here'),
      }),
    );

    const res = await request(server).get('/ready').expect(200);
    const body = res.body as ReadinessReport;

    expect(body.status).toBe('ready');
    expect(body.search.status).toBe('UNAVAILABLE');
  });

  it('returns 503 with the reason when MongoDB does not answer', async () => {
    const server = await serverWith(
      new FakeDb({ pingError: new Error('connection refused') }),
    );

    const res = await request(server).get('/ready').expect(503);
    const body = res.body as ReadinessReport;

    expect(body.status).toBe('unavailable');
    expect(body.mongodb).toEqual({
      status: 'down',
      error: 'connection refused',
    });
  });

  it('returns 503 and names the index that is missing', async () => {
    const server = await serverWith(
      new FakeDb({ indexNames: ['_id_', 'tenant_city_score'] }),
    );

    const res = await request(server).get('/ready').expect(503);
    const body = res.body as ReadinessReport;

    expect(body.status).toBe('unavailable');
    expect(body.indexes.missing).toContain('tenant_location_2dsphere');
    expect(body.indexes.missing).not.toContain('tenant_city_score');
  });

  it('is not served under the /v1 prefix', async () => {
    const server = await serverWith(new FakeDb({ indexNames: allIndexes }));

    await request(server).get('/v1/ready').expect(404);
  });
});
