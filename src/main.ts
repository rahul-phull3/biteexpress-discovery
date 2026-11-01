import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { Env } from './config/env.schema';
import { DOCS_PATH, setupApiDocs } from './docs/api-docs';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // Run the shutdown hooks on Ctrl+C and SIGTERM, so the MongoDB connection
  // pool is closed cleanly.
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  if (config.get('DOCS_ENABLED', { infer: true })) {
    setupApiDocs(app);
    new Logger('Bootstrap').log(`API documentation at /${DOCS_PATH}`);
  }
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
