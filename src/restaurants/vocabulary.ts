import { collapseWhitespace } from '../importer/text';

/** A name from the data and how many restaurants carry it. */
export interface NamedCount {
  name: string;
  count: number;
}

/**
 * The words the data itself uses: every city and every cuisine of a tenant's
 * active restaurants. It is read from the database, not written in code, so a
 * new city or cuisine works the day the first restaurant with it is created.
 */
export interface VocabularyData {
  cities: NamedCount[];
  cuisines: NamedCount[];
}

/**
 * Other names for the same city. A person types "Gurugram" or "Delhi"; the
 * dataset says "Gurgaon" and "New Delhi". An alias only counts when one of the
 * names of its group is a city in the data, so the table never invents a city.
 */
const CITY_ALIAS_GROUPS: ReadonlyArray<readonly string[]> = [
  ['Gurgaon', 'Gurugram'],
  ['New Delhi', 'Delhi'],
  ['Bangalore', 'Bengaluru'],
  ['Mumbai', 'Bombay'],
  ['Kolkata', 'Calcutta'],
  ['Chennai', 'Madras'],
  ['Vizag', 'Visakhapatnam', 'Vishakhapatnam'],
  ['Bhubaneshwar', 'Bhubaneswar'],
  ['Puducherry', 'Pondicherry'],
  ['Kochi', 'Cochin'],
  ['Mysore', 'Mysuru'],
  ['Mangalore', 'Mangaluru'],
  ['Allahabad', 'Prayagraj'],
  ['Varanasi', 'Banaras', 'Benares'],
  ['Vadodara', 'Baroda'],
];

/** A way to write a name, and the name the data uses for it. */
export interface VocabularyPhrase {
  /** As a person writes it, in lower case: "gurugram". */
  phrase: string;
  /** As the data spells it: "Gurgaon". */
  name: string;
}

/** The form in which two spellings are compared: tidy whitespace, lower case. */
const keyOf = (text: string): string => collapseWhitespace(text).toLowerCase();

/**
 * Turns what a person typed into what the data says, so that a query can use an
 * exact match (and therefore an index) instead of a case-insensitive search.
 * Text that is not in the data is returned tidied but otherwise unchanged; the
 * query then simply matches nothing.
 */
export class Vocabulary {
  private readonly cityByKey = new Map<string, string>();
  private readonly cuisineByKey = new Map<string, string>();

  constructor(readonly data: VocabularyData) {
    for (const { name } of data.cities) this.cityByKey.set(keyOf(name), name);
    for (const { name } of data.cuisines) this.cuisineByKey.set(keyOf(name), name);
  }

  /** The city as the data spells it: any letter case, and known aliases such as Gurugram. */
  canonicalCity(input: string): string {
    const key = keyOf(input);
    const exact = this.cityByKey.get(key);
    if (exact) return exact;

    const group = CITY_ALIAS_GROUPS.find((names) => names.some((name) => keyOf(name) === key));
    for (const name of group ?? []) {
      const known = this.cityByKey.get(keyOf(name));
      if (known) return known;
    }
    return collapseWhitespace(input);
  }

  /** The cuisine as the data spells it: any letter case. */
  canonicalCuisine(input: string): string {
    return this.cuisineByKey.get(keyOf(input)) ?? collapseWhitespace(input);
  }

  /**
   * Every way to write a city that `canonicalCity` understands: the cities of
   * the data and the aliases of those cities. What the search looks for in a sentence.
   */
  cityPhrases(): VocabularyPhrase[] {
    const phrases: VocabularyPhrase[] = this.data.cities.map(({ name }) => ({
      phrase: keyOf(name),
      name,
    }));
    for (const group of CITY_ALIAS_GROUPS) {
      const known = group.map((name) => this.cityByKey.get(keyOf(name))).find((name) => name);
      if (!known) continue;
      for (const alias of group) {
        if (!this.cityByKey.has(keyOf(alias))) phrases.push({ phrase: keyOf(alias), name: known });
      }
    }
    return phrases;
  }

  /** The cuisines of the data, as a person writes them. */
  cuisinePhrases(): VocabularyPhrase[] {
    return this.data.cuisines.map(({ name }) => ({ phrase: keyOf(name), name }));
  }
}
