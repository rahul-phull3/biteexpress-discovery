import {
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env, TENANT_ID_PATTERN } from '../config/env.schema';
import { validationProblem } from './problem';

/** The header that selects the tenant. Node lower-cases header names. */
export const TENANT_HEADER = 'x-tenant-id';

/**
 * The tenant a request acts for: the header when present and valid, otherwise
 * the configured default.
 *
 * DEMO ONLY. Trusting a header lets any caller act for any tenant. It exists so
 * a second tenant can be shown in one command. In production the tenant comes
 * from the caller's verified credential (an API key or a token claim) and never
 * from a header the client chooses.
 */
export function resolveTenantId(header: string | undefined, fallback: string): string {
  if (header === undefined) return fallback;
  const value = header.trim();
  if (!TENANT_ID_PATTERN.test(value)) {
    throw validationProblem(
      [
        {
          parameter: 'X-Tenant-Id',
          detail: 'use 1 to 64 letters, digits, underscores or hyphens',
        },
      ],
      'The X-Tenant-Id header is not valid.',
    );
  }
  return value;
}

/** Checks the raw header and falls back to the configured default tenant. */
@Injectable()
export class TenantIdPipe implements PipeTransform<string | undefined, string> {
  constructor(private readonly config: ConfigService<Env, true>) {}

  transform(header: string | undefined): string {
    return resolveTenantId(header, this.config.get('DEFAULT_TENANT_ID', { infer: true }));
  }
}

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Reads the raw header. Nest's own @Headers() cannot take a pipe, so this tiny
 * decorator reads it and TenantIdPipe checks it. A repeated header arrives
 * joined with ", ", which the pipe then refuses.
 */
const RawTenantHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const value = context.switchToHttp().getRequest<RequestWithHeaders>().headers[TENANT_HEADER];
    return Array.isArray(value) ? value.join(', ') : value;
  },
);

/** Use as `@TenantId() tenantId: string` in a controller method. */
export const TenantId = (): ParameterDecorator => RawTenantHeader(TenantIdPipe);
