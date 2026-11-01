import { envSchema } from './env.schema';

const defaults = {
  NODE_ENV: 'development',
  PORT: 3000,
  MONGODB_URI: 'mongodb://127.0.0.1:27017/?directConnection=true',
  MONGODB_DB: 'biteexpress',
  DEFAULT_TENANT_ID: 'biteexpress',
};

describe('envSchema', () => {
  it('applies the defaults when nothing is set', () => {
    expect(envSchema.parse({})).toEqual(defaults);
  });

  it('coerces PORT from a string', () => {
    expect(envSchema.parse({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a PORT that is not a number between 1 and 65535', () => {
    expect(envSchema.safeParse({ PORT: 'abc' }).success).toBe(false);
    expect(envSchema.safeParse({ PORT: '0' }).success).toBe(false);
    expect(envSchema.safeParse({ PORT: '70000' }).success).toBe(false);
    expect(envSchema.safeParse({ PORT: '' }).success).toBe(false);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(envSchema.safeParse({ NODE_ENV: 'staging' }).success).toBe(false);
  });

  it('accepts mongodb and mongodb+srv connection strings', () => {
    const local = 'mongodb://user:pass@db:27017/?directConnection=true';
    const atlas = 'mongodb+srv://user:pass@cluster0.example.mongodb.net/';
    expect(envSchema.parse({ MONGODB_URI: local }).MONGODB_URI).toBe(local);
    expect(envSchema.parse({ MONGODB_URI: atlas }).MONGODB_URI).toBe(atlas);
  });

  it('rejects a connection string that is empty or uses another scheme', () => {
    expect(envSchema.safeParse({ MONGODB_URI: '' }).success).toBe(false);
    expect(
      envSchema.safeParse({ MONGODB_URI: 'localhost:27017' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ MONGODB_URI: 'postgres://localhost/db' }).success,
    ).toBe(false);
  });

  it('rejects database names that MongoDB or Atlas would refuse', () => {
    expect(envSchema.safeParse({ MONGODB_DB: '' }).success).toBe(false);
    expect(envSchema.safeParse({ MONGODB_DB: 'bite.express' }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ MONGODB_DB: 'bite express' }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ MONGODB_DB: 'x'.repeat(39) }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ MONGODB_DB: 'x'.repeat(38) }).success).toBe(
      true,
    );
  });

  it('accepts a tenant id of letters, digits, underscores and hyphens', () => {
    expect(
      envSchema.parse({ DEFAULT_TENANT_ID: 'acme-eu_1' }).DEFAULT_TENANT_ID,
    ).toBe('acme-eu_1');
    expect(
      envSchema.safeParse({ DEFAULT_TENANT_ID: 'x'.repeat(64) }).success,
    ).toBe(true);
  });

  it('rejects a tenant id the collection validator or a URL would not like', () => {
    expect(envSchema.safeParse({ DEFAULT_TENANT_ID: '' }).success).toBe(false);
    expect(envSchema.safeParse({ DEFAULT_TENANT_ID: 'a b' }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ DEFAULT_TENANT_ID: 'a/b' }).success).toBe(
      false,
    );
    expect(
      envSchema.safeParse({ DEFAULT_TENANT_ID: 'x'.repeat(65) }).success,
    ).toBe(false);
  });

  it('ignores variables it does not declare', () => {
    expect(envSchema.parse({ PATH: '/usr/bin' })).toEqual(defaults);
  });
});
