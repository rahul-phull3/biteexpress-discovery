import { type Country, findCountry, zomatoCountryCodes } from '../importer/countries';

/**
 * The countries the API accepts, keyed by ISO 3166-1 alpha-2 code. They are the
 * 15 of the importer's table (importer/countries.ts), so the name and currency
 * of a restaurant created through the API are exactly the ones the importer
 * gives. Supporting another country is one more row in that table.
 */
const BY_ISO_CODE: ReadonlyMap<string, Country> = new Map(
  zomatoCountryCodes().flatMap((zomatoCode) => {
    const country = findCountry(zomatoCode);
    return country ? [[country.code, country] as const] : [];
  }),
);

/** The country for an ISO code such as "IN", or undefined when it is not supported. */
export function findCountryByIsoCode(code: string): Country | undefined {
  return BY_ISO_CODE.get(code);
}

/** The supported ISO codes, sorted. */
export function supportedCountryCodes(): string[] {
  return [...BY_ISO_CODE.keys()].sort();
}

/** Names people use for a country besides the one in the table, in lower case. */
const COUNTRY_NICKNAMES: ReadonlyMap<string, string> = new Map([
  ['uk', 'GB'],
  ['great britain', 'GB'],
  ['england', 'GB'],
  ['usa', 'US'],
  ['united states of america', 'US'],
  ['america', 'US'],
  ['uae', 'AE'],
  ['emirates', 'AE'],
  ['bharat', 'IN'],
]);

const BY_NAME: ReadonlyMap<string, string> = new Map(
  [...BY_ISO_CODE.values()].map((country) => [country.name.toLowerCase(), country.code] as const),
);

/**
 * What a sentence may call each country: the names and the nicknames, in lower
 * case, never the two-letter codes ("in" and "us" are ordinary words in a
 * sentence). The search reads "restaurants in India" with it.
 */
export function countryPhrases(): Array<{ phrase: string; code: string }> {
  return [...BY_NAME, ...COUNTRY_NICKNAMES].map(([phrase, code]) => ({ phrase, code }));
}

/**
 * The country for what a person types: an ISO code ("in"), a name ("India")
 * or a common nickname ("UK"), in any letter case. Undefined when it is none of them.
 */
export function findCountryByNameOrCode(input: string): Country | undefined {
  const value = input.trim();
  const byCode = BY_ISO_CODE.get(value.toUpperCase());
  if (byCode) return byCode;
  const lower = value.toLowerCase();
  const code = BY_NAME.get(lower) ?? COUNTRY_NICKNAMES.get(lower);
  return code ? BY_ISO_CODE.get(code) : undefined;
}
