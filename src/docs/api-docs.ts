import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from './openapi.document';

/** The Swagger UI is at /docs; the document itself at /docs/openapi.json and /docs/openapi.yaml. */
export const DOCS_PATH = 'docs';

/**
 * Serves the Swagger UI and the OpenAPI document. Called from main.ts when
 * DOCS_ENABLED is true (and by the e2e tests). Kept apart from configureApp so
 * that the documentation is a switch, not part of what the API needs to run.
 *
 * The document is hand-written (openapi.document.ts), so @nestjs/swagger only
 * serves it; it does not read the controllers. It is registered without the
 * global prefix: the UI is at /docs, not /v1/docs.
 */
export function setupApiDocs(app: INestApplication): void {
  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument() as unknown as OpenAPIObject, {
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    yamlDocumentUrl: `${DOCS_PATH}/openapi.yaml`,
    customSiteTitle: 'BiteExpress discovery API',
    swaggerOptions: { displayRequestDuration: true, tryItOutEnabled: true },
  });
}
