import { findCountry, zomatoCountryCodes } from './countries';

describe('findCountry', () => {
  it('knows the 15 countries of the take-home file', () => {
    expect(zomatoCountryCodes()).toHaveLength(15);
  });

  it('maps a Zomato code to the ISO code, the name and the currency', () => {
    expect(findCountry('1')).toEqual({
      code: 'IN',
      name: 'India',
      currency: 'INR',
    });
    expect(findCountry('216')).toEqual({
      code: 'US',
      name: 'United States',
      currency: 'USD',
    });
  });

  it('fixes the two names the workbook misspells or abbreviates', () => {
    expect(findCountry('162')?.name).toBe('Philippines');
    expect(findCountry('214')?.name).toBe('United Arab Emirates');
  });

  it('gives every country its own currency, not the CSV label "Dollar($)"', () => {
    const currencyOf = (zomatoCode: string) =>
      findCountry(zomatoCode)?.currency;
    expect(currencyOf('14')).toBe('AUD');
    expect(currencyOf('37')).toBe('CAD');
    expect(currencyOf('148')).toBe('NZD');
    expect(currencyOf('184')).toBe('SGD');
    expect(currencyOf('216')).toBe('USD');
    expect(currencyOf('162')).toBe('PHP');
    expect(currencyOf('215')).toBe('GBP');
  });

  it('uses upper-case two-letter ISO codes, as the collection validator requires', () => {
    for (const zomatoCode of zomatoCountryCodes()) {
      expect(findCountry(zomatoCode)?.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('uses each ISO code once', () => {
    const codes = zomatoCountryCodes().map((c) => findCountry(c)?.code);
    expect(new Set(codes).size).toBe(15);
  });

  it('ignores spaces around the code', () => {
    expect(findCountry(' 1 ')?.code).toBe('IN');
  });

  it('returns undefined for a code that is not in the table', () => {
    expect(findCountry('999')).toBeUndefined();
    expect(findCountry('')).toBeUndefined();
    expect(findCountry('constructor')).toBeUndefined();
    expect(findCountry('__proto__')).toBeUndefined();
  });
});
