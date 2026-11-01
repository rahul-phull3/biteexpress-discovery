import { ProblemException } from './problem';
import { resolveTenantId, TENANT_HEADER } from './tenant';

describe('resolveTenantId', () => {
  it('uses the default tenant when the header is absent', () => {
    expect(resolveTenantId(undefined, 'biteexpress')).toBe('biteexpress');
  });

  it('uses the header when it is valid, ignoring surrounding spaces', () => {
    expect(resolveTenantId('  acme_2-eu ', 'biteexpress')).toBe('acme_2-eu');
  });

  it('accepts the longest allowed id', () => {
    expect(resolveTenantId('t'.repeat(64), 'x')).toBe('t'.repeat(64));
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['with a space inside', 'two words'],
    ['with a slash', 'a/b'],
    ['with a dollar sign', '$ne'],
    ['two ids joined by a repeated header', 'a, b'],
    ['too long', 't'.repeat(65)],
  ])('refuses a header that is %s with a 400 that names the header', (_label, header) => {
    let caught: unknown;
    try {
      resolveTenantId(header, 'biteexpress');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProblemException);
    expect((caught as ProblemException).problem).toMatchObject({
      status: 400,
      errors: [{ parameter: 'X-Tenant-Id' }],
    });
  });

  it('reads the header under its lower-case name, which is how Node reports it', () => {
    expect(TENANT_HEADER).toBe('x-tenant-id');
  });
});
