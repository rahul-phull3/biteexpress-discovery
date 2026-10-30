import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { HealthResponse } from '../src/health/health.controller';
import { FakeDb } from './support/fake-db';
import { createAppWithFakeMongo } from './support/test-app';

describe('GET /health (e2e)', () => {
  let app: INestApplication;
  const mongo = new FakeDb();

  beforeAll(async () => {
    app = await createAppWithFakeMongo(mongo);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with a status payload and no caching', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = res.body as HealthResponse;

    expect(body.status).toBe('ok');
    expect(Number.isInteger(body.uptimeSeconds)).toBe(true);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('never touches MongoDB, so a database outage cannot get the container restarted', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);

    expect(mongo.calls).toEqual([]);
  });

  it('is not served under the /v1 prefix', async () => {
    await request(app.getHttpServer()).get('/v1/health').expect(404);
  });
});
