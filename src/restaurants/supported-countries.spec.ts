import {
  countryPhrases,
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

describe('countryPhrases', () => {
  const phrases = countryPhrases();

  it('lists the names and the nicknames, in lower case', () => {
    expect(phrases).toEqual(
      expect.arrayContaining([
        { phrase: 'india', code: 'IN' },
        { phrase: 'united arab emirates', code: 'AE' },
        { phrase: 'uk', code: 'GB' },
        { phrase: 'england', code: 'GB' },
        { phrase: 'usa', code: 'US' },
      ]),
    );
  });

  it('never lists a two-letter ISO code, which is an ordinary word in a sentence ("in", "us")', () => {
    const twoLetters = phrases.map((entry) => entry.phrase).filter((phrase) => phrase.length === 2);

    // "uk" is a nickname people write; every other two-letter phrase would be a mistake.
    expect(twoLetters).toEqual(['uk']);
  });

  it('points every phrase at a supported country', () => {
    for (const { phrase, code } of phrases) {
      expect(findCountryByIsoCode(code)).toBeDefined();
      expect(findCountryByNameOrCode(phrase)?.code).toBe(code);
    }
  });

  it('has a phrase for every supported country', () => {
    expect(new Set(phrases.map((entry) => entry.code))).toEqual(new Set(supportedCountryCodes()));
  });
});
