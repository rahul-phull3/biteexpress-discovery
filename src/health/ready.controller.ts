import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Db } from 'mongodb';
import { MONGO_DB } from '../database/database.constants';
import { inspectReadiness, type ReadinessReport } from './readiness';

/**
 * Readiness probe: can this instance serve traffic right now?
 *
 * 200 when MongoDB answers and every expected index exists. Otherwise 503 with
 * the same report, so a load balancer stops sending traffic here and a person
 * can see why. Compare GET /health, which only says the process is alive.
 */
@Controller('ready')
export class ReadyController {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check(): Promise<ReadinessReport> {
    const report = await inspectReadiness(this.db);
    if (report.status !== 'ready') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
