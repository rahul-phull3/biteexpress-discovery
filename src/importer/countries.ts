export interface Country {
  /** ISO 3166-1 alpha-2, the form the collection validator requires. */
  code: string;
  name: string;
  /** ISO 4217 currency of the country. */
  currency: string;
}

/**
 * The 15 rows of Country-Code.xlsx, keyed by Zomato's numeric country code.
 * The workbook has no ISO codes and the CSV has no country names, so this table
 * joins the two. Two spellings are fixed ("Phillipines", "UAE"), and the
 * currency comes from the country because the CSV's Currency column is
 * unreliable: "Dollar($)" covers four countries, the Philippines are labelled
 * "Botswana Pula(P)" and the British pound carries a stray byte.
 *
 * A Map, not an object, so a code such as "constructor" can never match.
 */
const COUNTRIES: ReadonlyMap<string, Country> = new Map<string, Country>([
  ['1', { code: 'IN', name: 'India', currency: 'INR' }],
  ['14', { code: 'AU', name: 'Australia', currency: 'AUD' }],
  ['30', { code: 'BR', name: 'Brazil', currency: 'BRL' }],
  ['37', { code: 'CA', name: 'Canada', currency: 'CAD' }],
  ['94', { code: 'ID', name: 'Indonesia', currency: 'IDR' }],
  ['148', { code: 'NZ', name: 'New Zealand', currency: 'NZD' }],
  ['162', { code: 'PH', name: 'Philippines', currency: 'PHP' }],
  ['166', { code: 'QA', name: 'Qatar', currency: 'QAR' }],
  ['184', { code: 'SG', name: 'Singapore', currency: 'SGD' }],
  ['189', { code: 'ZA', name: 'South Africa', currency: 'ZAR' }],
  ['191', { code: 'LK', name: 'Sri Lanka', currency: 'LKR' }],
  ['208', { code: 'TR', name: 'Turkey', currency: 'TRY' }],
  ['214', { code: 'AE', name: 'United Arab Emirates', currency: 'AED' }],
  ['215', { code: 'GB', name: 'United Kingdom', currency: 'GBP' }],
  ['216', { code: 'US', name: 'United States', currency: 'USD' }],
]);

/** The country for a Zomato numeric code, or undefined when the code is not in the table. */
export function findCountry(zomatoCode: string): Country | undefined {
  return COUNTRIES.get(zomatoCode.trim());
}

/** Every Zomato code in the table. */
export function zomatoCountryCodes(): string[] {
  return [...COUNTRIES.keys()];
}
