import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HealthController } from './health.controller';
import { ReadyController } from './ready.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, ReadyController],
})
export class HealthModule {}
