import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RestaurantsModule } from './restaurants/restaurants.module';

@Module({
  imports: [
    // validate (not validationSchema, which expects a Joi schema): the schema is Zod.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    HealthModule,
    RestaurantsModule,
  ],
})
export class AppModule {}
