import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // Run the shutdown hooks on Ctrl+C and SIGTERM, so the MongoDB connection
  // pool is closed cleanly.
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}

bootstrap().catch((error: unknown) => {
  // Print a readable message and exit non-zero, so Docker and CI notice.
  new Logger('Bootstrap').error(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
