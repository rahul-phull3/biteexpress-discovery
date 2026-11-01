import { envSchema, validateEnv } from './env.schema';

const defaults = {
  NODE_ENV: 'development',
  PORT: 3000,
  MONGODB_URI: 'mongodb://127.0.0.1:27017/?directConnection=true',
  MONGODB_DB: 'biteexpress',
  DEFAULT_TENANT_ID: 'biteexpress',
  READ_TIMEOUT_MS: 2000,
  SEARCH_ENGINE: 'atlas',
  DOCS_ENABLED: true,
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

  it('limits a read to 2 seconds unless told otherwise, and coerces the number', () => {
    expect(envSchema.parse({}).READ_TIMEOUT_MS).toBe(2000);
    expect(envSchema.parse({ READ_TIMEOUT_MS: '500' }).READ_TIMEOUT_MS).toBe(500);
  });

  it('rejects a read limit that would fail healthy queries, protect nothing, or is not a whole number', () => {
    for (const value of ['', '0', '99', '60001', '1.5', 'soon', '-1']) {
      expect(envSchema.safeParse({ READ_TIMEOUT_MS: value }).success).toBe(false);
    }
    expect(envSchema.safeParse({ READ_TIMEOUT_MS: '100' }).success).toBe(true);
    expect(envSchema.safeParse({ READ_TIMEOUT_MS: '60000' }).success).toBe(true);
  });

  it('uses Atlas Search for sentences unless rules are asked for', () => {
    expect(envSchema.parse({}).SEARCH_ENGINE).toBe('atlas');
    expect(envSchema.parse({ SEARCH_ENGINE: 'rules' }).SEARCH_ENGINE).toBe('rules');
    expect(envSchema.safeParse({ SEARCH_ENGINE: 'elastic' }).success).toBe(false);
    expect(envSchema.safeParse({ SEARCH_ENGINE: '' }).success).toBe(false);
  });

  it('turns the docs switch into a boolean and refuses any other spelling', () => {
    expect(envSchema.parse({}).DOCS_ENABLED).toBe(true);
    expect(envSchema.parse({ DOCS_ENABLED: 'true' }).DOCS_ENABLED).toBe(true);
    expect(envSchema.parse({ DOCS_ENABLED: 'false' }).DOCS_ENABLED).toBe(false);
    // "false" must never be read as a truthy string.
    for (const value of ['', '0', 'no', 'FALSE', 'yes']) {
      expect(envSchema.safeParse({ DOCS_ENABLED: value }).success).toBe(false);
    }
  });
});

describe('validateEnv', () => {
  it('returns the validated values with the defaults applied', () => {
    expect(validateEnv({ PORT: '8080', PATH: '/usr/bin' })).toEqual({
      ...defaults,
      PORT: 8080,
    });
  });

  it('throws one error that names every variable that is wrong', () => {
    const attempt = () =>
      validateEnv({ PORT: 'abc', MONGODB_DB: 'bite.express', READ_TIMEOUT_MS: '5' });

    expect(attempt).toThrow(/^Invalid configuration:/);
    expect(attempt).toThrow(/PORT:/);
    expect(attempt).toThrow(/MONGODB_DB:/);
    expect(attempt).toThrow(/READ_TIMEOUT_MS:/);
  });
});
