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

  it('keeps the data it was built from, with the counts', () => {
    const source: VocabularyData = {
      cities: [{ name: 'Gurgaon', count: 1118 }],
      cuisines: [{ name: 'Thai', count: 400 }],
    };

    expect(new Vocabulary(source).data).toBe(source);
  });
});
