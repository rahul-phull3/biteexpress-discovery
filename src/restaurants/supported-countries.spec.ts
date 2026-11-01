import {
  findCountryByIsoCode,
  findCountryByNameOrCode,
  supportedCountryCodes,
} from './supported-countries';

describe('findCountryByNameOrCode', () => {
  it.each([
    ['IN', 'IN'],
    ['in', 'IN'],
    [' In ', 'IN'],
    ['India', 'IN'],
    ['india', 'IN'],
    ['United Kingdom', 'GB'],
    ['uk', 'GB'],
    ['England', 'GB'],
    ['USA', 'US'],
    ['united states', 'US'],
    ['UAE', 'AE'],
    ['United Arab Emirates', 'AE'],
    ['New Zealand', 'NZ'],
  ])('finds %s', (input, code) => {
    expect(findCountryByNameOrCode(input)?.code).toBe(code);
  });

  it.each(['', 'Atlantis', 'XX', 'constructor', '__proto__', 'Indi'])(
    'does not find %j',
    (input) => {
      expect(findCountryByNameOrCode(input)).toBeUndefined();
    },
  );

  it('returns the country with its name and currency', () => {
    expect(findCountryByNameOrCode('india')).toEqual({ code: 'IN', name: 'India', currency: 'INR' });
  });

  it('knows every supported code', () => {
    for (const code of supportedCountryCodes()) {
      expect(findCountryByNameOrCode(code)).toBe(findCountryByIsoCode(code));
    }
  });
});
