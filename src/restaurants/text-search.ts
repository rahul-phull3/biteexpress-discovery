/** Dependency-injection token of the TextSearch that the restaurants service uses. */
export const TEXT_SEARCH = Symbol('TEXT_SEARCH');

/**
 * What the search does with the words of a sentence that are neither a place nor
 * a filter: "vada pav" in "nearest place that serves vada pav".
 *
 *  - The 'atlas' engine asks Atlas Search which restaurants those words fit
 *    (whole words, the start of a word, one typo), and the listing then runs on
 *    only those restaurants, with every other filter and the sort as usual.
 *  - The 'rules' engine does nothing here. The listing itself keeps the
 *    restaurants whose name or area contains each word, as plain text.
 *
 * The 'atlas' engine can fail to answer (its index is still being built, or
 * the database has no Atlas Search at all). It then says so with `null`, and the
 * search carries on with the rules and tells the client that it did.
 */
export interface TextSearch {
  readonly engine: 'atlas' | 'rules';
  /**
   * The ids of the tenant's active restaurants whose name or area fits every
   * word, best match first, at most a few hundred. An empty list means that
   * nothing fits. `null` means that this engine could not answer.
   */
  candidates(tenantId: string, words: readonly string[]): Promise<string[] | null>;
}

/** The plain rules: it names no candidates, so the listing matches the words itself. */
export class RulesTextSearch implements TextSearch {
  readonly engine = 'rules';

  async candidates(): Promise<null> {
    return null;
  }
}

/** What the service uses when it is given nothing else, and what the tests use. */
export const RULES_ONLY: TextSearch = new RulesTextSearch();
