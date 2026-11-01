import { Vocabulary, type VocabularyData } from './vocabulary';

/** How long a tenant's vocabulary is reused before the database is asked again. */
export const VOCABULARY_TTL_MS = 60_000;

/**
 * Keeps one Vocabulary per tenant for a short time. Listing needs it on every
 * request, and cities and cuisines change rarely, so asking the database each
 * time would add a pair of aggregations to every page. Concurrent requests
 * share one load, and a failed load is not remembered.
 */
export class VocabularyCache {
  private readonly entries = new Map<string, { expiresAt: number; value: Promise<Vocabulary> }>();

  constructor(
    private readonly load: (tenantId: string) => Promise<VocabularyData>,
    private readonly ttlMs: number = VOCABULARY_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(tenantId: string): Promise<Vocabulary> {
    const cached = this.entries.get(tenantId);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const value = this.load(tenantId).then((data) => new Vocabulary(data));
    this.entries.set(tenantId, { expiresAt: this.now() + this.ttlMs, value });
    value.catch(() => {
      if (this.entries.get(tenantId)?.value === value) this.entries.delete(tenantId);
    });
    return value;
  }

  /** Forget a tenant's vocabulary, for example after it gained a restaurant in a new city. */
  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
  }
}
