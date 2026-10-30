import { envSchema } from './env.schema';

describe('envSchema', () => {
  it('applies the defaults when nothing is set', () => {
    expect(envSchema.parse({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
    });
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

  it('ignores variables it does not declare', () => {
    expect(envSchema.parse({ PATH: '/usr/bin' })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
    });
  });
});
