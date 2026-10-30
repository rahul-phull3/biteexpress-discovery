import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { HealthResponse } from '../src/health/health.controller';

describe('GET /health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
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

  it('is not served under the /v1 prefix', async () => {
    await request(app.getHttpServer()).get('/v1/health').expect(404);
  });
});
