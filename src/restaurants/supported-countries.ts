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
