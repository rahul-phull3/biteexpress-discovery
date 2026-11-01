import { Vocabulary, type VocabularyData } from './vocabulary';

const names = (...values: string[]) => values.map((name) => ({ name, count: 1 }));

const data = (cities: string[], cuisines: string[] = []): VocabularyData => ({
  cities: names(...cities),
  cuisines: names(...cuisines),
});

describe('Vocabulary', () => {
  describe('canonicalCity', () => {
    const vocabulary = new Vocabulary(data(['Gurgaon', 'New Delhi', 'Bangalore', 'Mumbai']));

    it('returns the spelling of the data for any letter case and spacing', () => {
      expect(vocabulary.canonicalCity('gurgaon')).toBe('Gurgaon');
      expect(vocabulary.canonicalCity('GURGAON')).toBe('Gurgaon');
      expect(vocabulary.canonicalCity('  new   delhi ')).toBe('New Delhi');
    });

    it('turns a well-known other name into the one the data uses', () => {
      expect(vocabulary.canonicalCity('Gurugram')).toBe('Gurgaon');
      expect(vocabulary.canonicalCity('gurugram')).toBe('Gurgaon');
      expect(vocabulary.canonicalCity('Delhi')).toBe('New Delhi');
      expect(vocabulary.canonicalCity('Bengaluru')).toBe('Bangalore');
      expect(vocabulary.canonicalCity('Bombay')).toBe('Mumbai');
    });

    it('works the other way round when the data uses the newer name', () => {
      const modern = new Vocabulary(data(['Gurugram', 'Bengaluru']));

      expect(modern.canonicalCity('Gurgaon')).toBe('Gurugram');
      expect(modern.canonicalCity('bangalore')).toBe('Bengaluru');
    });

    it('does not invent a city: an alias counts only when the data has a city of that group', () => {
      const small = new Vocabulary(data(['Mumbai']));

      expect(small.canonicalCity('Gurugram')).toBe('Gurugram');
      expect(small.canonicalCity('Delhi')).toBe('Delhi');
    });

    it('prefers a city that exists under the exact name over an alias group', () => {
      const both = new Vocabulary(data(['Delhi', 'New Delhi']));

      expect(both.canonicalCity('delhi')).toBe('Delhi');
      expect(both.canonicalCity('New Delhi')).toBe('New Delhi');
    });

    it('returns an unknown city tidied but otherwise as typed, so the query matches nothing', () => {
      expect(vocabulary.canonicalCity('  Atlantis  ')).toBe('Atlantis');
      expect(vocabulary.canonicalCity('atlantis')).toBe('atlantis');
    });

    it('knows nothing when the data has no cities', () => {
      expect(new Vocabulary(data([])).canonicalCity('Gurugram')).toBe('Gurugram');
    });
  });

  describe('canonicalCuisine', () => {
    const vocabulary = new Vocabulary(data([], ['South Indian', 'Thai', 'Fast Food']));

    it('returns the spelling of the data for any letter case and spacing', () => {
      expect(vocabulary.canonicalCuisine('south indian')).toBe('South Indian');
      expect(vocabulary.canonicalCuisine('THAI')).toBe('Thai');
      expect(vocabulary.canonicalCuisine(' fast   food ')).toBe('Fast Food');
    });

    it('returns an unknown cuisine tidied but otherwise as typed', () => {
      expect(vocabulary.canonicalCuisine('  vada  pav ')).toBe('vada pav');
    });
  });

  describe('cityPhrases', () => {
    it('lists the cities of the data as people write them, in lower case', () => {
      const vocabulary = new Vocabulary(data(['Gurgaon', 'New Delhi']));

      expect(vocabulary.cityPhrases()).toEqual(
        expect.arrayContaining([
          { phrase: 'gurgaon', name: 'Gurgaon' },
          { phrase: 'new delhi', name: 'New Delhi' },
        ]),
      );
    });

    it('adds the other names of those cities, pointing at the name the data uses', () => {
      const phrases = new Vocabulary(data(['Gurgaon', 'New Delhi', 'Bangalore'])).cityPhrases();

      expect(phrases).toEqual(
        expect.arrayContaining([
          { phrase: 'gurugram', name: 'Gurgaon' },
          { phrase: 'delhi', name: 'New Delhi' },
          { phrase: 'bengaluru', name: 'Bangalore' },
        ]),
      );
    });

    it('does not invent a city: no alias of a city that the data lacks', () => {
      const phrases = new Vocabulary(data(['Mumbai'])).cityPhrases().map((entry) => entry.phrase);

      expect(phrases).toContain('bombay');
      expect(phrases).not.toContain('gurugram');
      expect(phrases).not.toContain('delhi');
    });

    it('does not turn a name that the data has itself into an alias', () => {
      const phrases = new Vocabulary(data(['Delhi', 'New Delhi'])).cityPhrases();

      expect(phrases.filter((entry) => entry.phrase === 'delhi')).toEqual([{ phrase: 'delhi', name: 'Delhi' }]);
    });

    it('agrees with canonicalCity about every phrase', () => {
      const vocabulary = new Vocabulary(
        data(['Gurgaon', 'New Delhi', 'Bangalore', 'Mumbai', 'Kolkata', 'Vizag', 'Kochi']),
      );

      for (const { phrase, name } of vocabulary.cityPhrases()) {
        expect(vocabulary.canonicalCity(phrase)).toBe(name);
      }
    });
  });

  describe('cuisinePhrases', () => {
    it('lists the cuisines of the data in lower case, pointing at the spelling of the data', () => {
      expect(new Vocabulary(data([], ['South Indian', 'Thai'])).cuisinePhrases()).toEqual([
        { phrase: 'south indian', name: 'South Indian' },
        { phrase: 'thai', name: 'Thai' },
      ]);
    });
  });

  it('keeps the data it was built from, with the counts', () => {
    const source: VocabularyData = {
      cities: [{ name: 'Gurgaon', count: 1118 }],
      cuisines: [{ name: 'Thai', count: 400 }],
    };

    expect(new Vocabulary(source).data).toBe(source);
  });
});
