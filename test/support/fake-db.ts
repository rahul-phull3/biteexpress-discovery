import type { Db } from 'mongodb';

/** An error shaped like the ones MongoDB servers send: a message and a numeric code. */
export function serverError(
  code: number,
  message: string,
): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

export interface FakeDbOptions {
  /** Collections that already exist. */
  collections?: string[];
  /** Index names that listIndexes reports. Defaults to just _id_. */
  indexNames?: string[];
  listIndexesError?: Error;
  /** What listSearchIndexes returns, or the error it throws. */
  searchIndexes?: Array<Record<string, unknown>> | Error;
  pingError?: Error;
  /** The ping never answers, to test time limits. */
  pingHangs?: boolean;
  createCollectionError?: Error;
  createIndexesError?: Error;
  createSearchIndexError?: Error;
}

/**
 * A small stand-in for the parts of the MongoDB Db API that the app uses at
 * startup and in /ready. It records every call in `calls`, so a test can
 * assert what the code asked MongoDB to do.
 *
 * It proves control flow only. Whether a validator, an index or a unique
 * constraint really works is proven against a real MongoDB in
 * test/mongo.int-spec.ts.
 */
export class FakeDb {
  readonly calls: string[] = [];
  readonly createCollectionArgs: Array<{ name: string; options: unknown }> = [];
  readonly collModArgs: unknown[] = [];

  constructor(private readonly options: FakeDbOptions = {}) {}

  asDb(): Db {
    return this as unknown as Db;
  }

  listCollections(filter: { name?: string }) {
    this.calls.push('listCollections');
    const names = (this.options.collections ?? []).filter(
      (name) => filter.name === undefined || name === filter.name,
    );
    return { toArray: async () => names.map((name) => ({ name })) };
  }

  async createCollection(name: string, options: unknown): Promise<void> {
    this.calls.push(`createCollection:${name}`);
    this.createCollectionArgs.push({ name, options });
    if (this.options.createCollectionError) {
      throw this.options.createCollectionError;
    }
  }

  async command(command: Record<string, unknown>): Promise<unknown> {
    if ('ping' in command) {
      this.calls.push('ping');
      if (this.options.pingHangs) return new Promise(() => undefined);
      if (this.options.pingError) throw this.options.pingError;
      return { ok: 1 };
    }
    if ('collMod' in command) {
      this.calls.push(`collMod:${String(command.collMod)}`);
      this.collModArgs.push(command);
      return { ok: 1 };
    }
    throw new Error(
      `FakeDb: unexpected command ${JSON.stringify(Object.keys(command))}`,
    );
  }

  collection(name: string) {
    return {
      createIndexes: async (specs: Array<{ name?: string }>) => {
        this.calls.push(`createIndexes:${name}:${specs.length}`);
        if (this.options.createIndexesError) {
          throw this.options.createIndexesError;
        }
        return specs.map((spec) => spec.name ?? '');
      },
      listIndexes: () => {
        this.calls.push('listIndexes');
        return {
          toArray: async () => {
            if (this.options.listIndexesError) {
              throw this.options.listIndexesError;
            }
            return (this.options.indexNames ?? ['_id_']).map((index) => ({
              name: index,
            }));
          },
        };
      },
      listSearchIndexes: (indexName: string) => {
        this.calls.push(`listSearchIndexes:${indexName}`);
        return {
          toArray: async () => {
            const result = this.options.searchIndexes ?? [];
            if (result instanceof Error) throw result;
            return result;
          },
        };
      },
      createSearchIndex: async (description: { name?: string }) => {
        this.calls.push(`createSearchIndex:${description.name ?? ''}`);
        if (this.options.createSearchIndexError) {
          throw this.options.createSearchIndexError;
        }
        return description.name ?? '';
      },
    };
  }
}
