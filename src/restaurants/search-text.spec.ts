import { listQuerySchema } from './list-query.schema';
import { MAX_TEXT_WORDS, NEAR_ME_KM, parseSearchText, type SearchFilters } from './search-text';
import { Vocabulary } from './vocabulary';

const count = (name: string) => ({ name, count: 1 });

// A small slice of the real data: the cities and cuisines the examples need,
// including ones that are easy to mistake for each other.
const vocabulary = new Vocabulary({
  cities: ['Gurgaon', 'New Delhi', 'Mumbai', 'Noida', 'Pune', 'Goa', 'Singapore', 'London', 'São Paulo'].map(count),
  cuisines: [
    'Bakery',
    'Biryani',
    'Burger',
    'Cafe',
    'Chinese',
    'Coffee and Tea',
    'Fast Food',
    'Indian',
    'Italian',
    'Kebab',
    'Mughlai',
    'North Indian',
    'Pizza',
    'Sandwich',
    'South Indian',
    'Street Food',
    'Thai',
  ].map(count),
});

const parse = (text: string) => parseSearchText(text, vocabulary);
const filtersOf = (text: string): SearchFilters => parse(text).filters;

describe('parseSearchText', () => {
  describe('the examples of the brief', () => {
    it('reads "Best restaurants in Gurgaon with South Indian Food"', () => {
      expect(parse('Best restaurants in Gurgaon with South Indian Food')).toEqual({
        filters: { sort: 'rating', city: 'Gurgaon', cuisine: ['South Indian'] },
        words: [],
        locationWanted: false,
        notes: [],
        priceNotes: [],
        radiusNotes: [],
      });
    });

    it('reads "Restaurants in Gurgaon under Rs. 1000 for two"', () => {
      expect(parse('Restaurants in Gurgaon under Rs. 1000 for two')).toEqual({
        filters: { city: 'Gurgaon', maxCost: 999, currency: 'INR' },
        words: [],
        locationWanted: false,
        notes: [],
        priceNotes: [],
        radiusNotes: [],
      });
    });

    it('reads "Nearest place that serves Vada Pav": the nearest first, and two words to look for in names', () => {
      const parsed = parse('Nearest place that serves Vada Pav');

      expect(parsed.filters).toEqual({ sort: 'distance' });
      expect(parsed.words).toEqual(['vada', 'pav']);
      expect(parsed.locationWanted).toBe(true);
      expect(parsed.notes).toEqual([
        '"vada", "pav" are not a city, country, cuisine or filter, so each word must appear in a restaurant\'s name or area. The data has no menu items to search.',
      ]);
    });
  });

  describe('cities', () => {
    it.each([
      ['restaurants in Gurgaon', 'Gurgaon'],
      ['GURGAON restaurants', 'Gurgaon'],
      ['restaurants in Gurugram', 'Gurgaon'],
      ['restaurants in Delhi', 'New Delhi'],
      ['restaurants in new delhi', 'New Delhi'],
      ['restaurants in Bombay', 'Mumbai'],
      ['pizza in sao paulo', 'São Paulo'],
      ['pizza in São Paulo', 'São Paulo'],
    ])('reads the city in "%s" as %s', (text, city) => {
      expect(filtersOf(text).city).toBe(city);
    });

    it('does not invent a city that is not in the data, and looks for its name instead', () => {
      // Bengaluru is an alias of Bangalore, which this vocabulary does not have.
      const parsed = parse('restaurants in Bengaluru');

      expect(parsed.filters).toEqual({});
      expect(parsed.words).toEqual(['bengaluru']);
    });

    it('uses the first of several cities and says that it ignored the others', () => {
      const parsed = parse('restaurants in Gurgaon, Noida or Pune');

      expect(parsed.filters.city).toBe('Gurgaon');
      expect(parsed.notes).toEqual(['More than one city was named; Gurgaon was used and Noida, Pune was ignored.']);
    });
  });

  describe('countries', () => {
    it.each([
      ['restaurants in India', 'IN'],
      ['restaurants in the UK', 'GB'],
      ['restaurants in England', 'GB'],
      ['restaurants in USA', 'US'],
      ['restaurants in United Arab Emirates', 'AE'],
      ['restaurants in UAE', 'AE'],
    ])('reads the country in "%s" as %s', (text, code) => {
      expect(filtersOf(text).country).toBe(code);
    });

    it('never reads an ordinary word as a country code', () => {
      expect(filtersOf('show us the restaurants in Pune')).toEqual({ city: 'Pune' });
      expect(filtersOf('restaurants in IN')).toEqual({});
    });

    it('prefers a city to a country of the same name, since the city says more', () => {
      expect(filtersOf('restaurants in Singapore')).toEqual({ city: 'Singapore' });
    });

    it('uses the first of several countries and says so', () => {
      const parsed = parse('restaurants in India or the UK');

      expect(parsed.filters.country).toBe('IN');
      expect(parsed.notes).toEqual(['More than one country was named; IN was used and GB was ignored.']);
    });
  });

  describe('cuisines', () => {
    it.each([
      ['Chinese food', ['Chinese']],
      ['CHINESE', ['Chinese']],
      ['burgers', ['Burger']],
      ['pizzas', ['Pizza']],
      ['sandwiches', ['Sandwich']],
      ['bakeries', ['Bakery']],
      ['cafes', ['Cafe']],
      ['cafés', ['Cafe']],
      ['kebabs', ['Kebab']],
      ['street food', ['Street Food']],
      ['coffee and tea', ['Coffee and Tea']],
    ])('reads the cuisine in "%s" as %j', (text, cuisine) => {
      expect(filtersOf(text).cuisine).toEqual(cuisine);
    });

    it('takes the longest cuisine name at each position: South Indian is not Indian', () => {
      expect(filtersOf('south indian')).toEqual({ cuisine: ['South Indian'] });
      expect(filtersOf('indian')).toEqual({ cuisine: ['Indian'] });
      expect(filtersOf('north indian and south indian')).toEqual({ cuisine: ['North Indian', 'South Indian'] });
    });

    it('collects several cuisines in the order they were written, once each', () => {
      expect(filtersOf('burgers, pizzas and sandwiches')).toEqual({ cuisine: ['Burger', 'Pizza', 'Sandwich'] });
      expect(filtersOf('thai thai thai')).toEqual({ cuisine: ['Thai'] });
    });

    describe('when one name contains another', () => {
      const overlapping = new Vocabulary({
        cities: ['Pune'].map(count),
        cuisines: ['Thai', 'Thai Fusion', 'Misal Pune'].map(count),
      });
      const read = (text: string) => parseSearchText(text, overlapping);

      it('takes the longest name that fits: "Thai Fusion", not "Thai" and a stray word', () => {
        expect(read('thai fusion')).toMatchObject({ filters: { cuisine: ['Thai Fusion'] }, words: [] });
        expect(read('thai')).toMatchObject({ filters: { cuisine: ['Thai'] }, words: [] });
      });

      it('does not build a name out of a word that was already taken as a city', () => {
        expect(read('misal pune')).toMatchObject({ filters: { city: 'Pune' }, words: ['misal'] });
        expect(read('misal pune').filters.cuisine).toBeUndefined();
      });
    });

    it('does not turn a word that is not a cuisine into one', () => {
      const parsed = parse('Mexican food');

      expect(parsed.filters).toEqual({});
      expect(parsed.words).toEqual(['mexican']);
    });
  });

  describe('prices', () => {
    it.each([
      ['under Rs. 1000 for two', { maxCost: 999, currency: 'INR' }],
      ['under ₹1000', { maxCost: 999, currency: 'INR' }],
      ['below 1,000 rupees', { maxCost: 999, currency: 'INR' }],
      ['less than 500 inr', { maxCost: 499, currency: 'INR' }],
      ['up to Rs 800', { maxCost: 800, currency: 'INR' }],
      ['within 800 rupees', { maxCost: 800, currency: 'INR' }],
      ['at most 1200 for two', { maxCost: 1200 }],
      ['not more than 1500', { maxCost: 1500 }],
      ['max 700', { maxCost: 700 }],
      ['budget of 600', { maxCost: 600 }],
      ['over Rs 2000', { minCost: 2001, currency: 'INR' }],
      ['above 2,000 for 2', { minCost: 2001 }],
      ['more than $60', { minCost: 61, currency: 'USD' }],
      ['at least £50', { minCost: 50, currency: 'GBP' }],
      ['minimum 300 aed', { minCost: 300, currency: 'AED' }],
      ['between Rs 500 and Rs 1500', { minCost: 500, maxCost: 1500, currency: 'INR' }],
      ['from 500 to 1500', { minCost: 500, maxCost: 1500 }],
      ['between 1500 and 500 for two', { minCost: 500, maxCost: 1500 }],
      ['500-1000 rupees', { minCost: 500, maxCost: 1000, currency: 'INR' }],
      ['under 1.5k', { maxCost: 1499 }],
      ['under 2 thousand rupees', { maxCost: 1999, currency: 'INR' }],
      ['under 20 SGD', { maxCost: 19, currency: 'SGD' }],
      ['over 500 and under 1000', { minCost: 501, maxCost: 999 }],
      // Costs are whole numbers, so a bound with a fraction rounds to the side that keeps the meaning.
      ['under Rs 99.5', { maxCost: 99, currency: 'INR' }],
      ['up to Rs 99.5', { maxCost: 99, currency: 'INR' }],
      ['over Rs 99.5', { minCost: 100, currency: 'INR' }],
      ['at least Rs 99.5', { minCost: 100, currency: 'INR' }],
    ])('reads "%s"', (text, expected) => {
      expect(filtersOf(text)).toEqual(expected);
    });

    it('says when the amount has no currency, since each restaurant is then compared in its own', () => {
      expect(parse('under 1000').notes).toEqual([
        "The text names no currency, so the amount is compared in each restaurant's own currency.",
      ]);
      expect(parse('under Rs 1000').notes).toEqual([]);
    });

    it('doubles an amount per person, because the data states the cost for two', () => {
      expect(parse('under 500 per person')).toMatchObject({
        filters: { maxCost: 999 },
        notes: expect.arrayContaining(['Costs in the data are for two people, so an amount per person was doubled.']),
      });
      expect(filtersOf('between 400 and 800 a head')).toMatchObject({ minCost: 800, maxCost: 1600 });
    });

    it('reads a bare amount with a currency as a maximum, and says so', () => {
      const parsed = parse('Rs 1000 for two');

      expect(parsed.filters).toEqual({ maxCost: 1000, currency: 'INR' });
      expect(parsed.notes).toEqual(['"rs 1000 for two" has no "under" or "over", so it was read as a maximum.']);
    });

    it('drops both bounds when they contradict each other, and says so', () => {
      const parsed = parse('over 2000 and under 1000 rupees');

      expect(parsed.filters).toEqual({});
      expect(parsed.notes).toEqual(['The price bounds contradict each other (at least 2001, at most 999), so both were ignored.']);
    });

    it('does not take a duration, a small number or a plain range of numbers for a price', () => {
      expect(parse('under 30 minutes').filters).toEqual({});
      expect(parse('under 30 minutes').words).toEqual(['30', 'minutes']);
      expect(filtersOf('over 5')).toEqual({});
      expect(filtersOf('3 to 4')).toEqual({});
    });

    it('never produces a negative amount', () => {
      expect(filtersOf('under 0 rupees')).toEqual({ maxCost: 0, currency: 'INR' });
    });

    it('ignores an amount above what the API accepts', () => {
      const parsed = parse('over 999999999999 rupees');

      expect(parsed.filters).toEqual({});
      expect(parsed.notes).toContain('An amount above 100000000 was ignored.');
    });
  });

  describe('ratings', () => {
    it.each([
      ['rated above 4', 4],
      ['rated 4.5', 4.5],
      ['rating of at least 4', 4],
      ['rating over 3.5', 3.5],
      ['4 stars', 4],
      ['4.5 star and above', 4.5],
      ['4+ stars', 4],
      ['above 4 stars', 4],
      ['4+ rated', 4],
      ['5 star restaurants', 5],
    ])('reads "%s" as a rating of at least %d', (text, minRating) => {
      expect(filtersOf(text)).toEqual({ minRating });
    });

    it('ignores a rating beyond the scale, and says so', () => {
      const parsed = parse('rated 6');

      expect(parsed.filters).toEqual({});
      expect(parsed.notes).toEqual(['Ratings run from 0 to 5, so "rated 6" was ignored.']);
    });

    it('uses the first of several ratings', () => {
      expect(filtersOf('rated above 4 and 3 stars')).toEqual({ minRating: 4 });
    });

    it('does not take the number of a price for a rating', () => {
      expect(filtersOf('rated 4 and under 1000 rupees')).toEqual({ minRating: 4, maxCost: 999, currency: 'INR' });
    });
  });

  describe('distances', () => {
    it.each([
      ['within 5 km', 5],
      ['in a 2 km radius', 2],
      ['5km', 5],
      ['within 2 miles', 3.219],
      ['500 m away', 0.5],
      ['within 250 metres', 0.25],
    ])('reads "%s" as a radius of %d km, and wants a location', (text, radiusKm) => {
      expect(parse(text)).toMatchObject({ filters: { radiusKm }, locationWanted: true });
    });

    it('cuts a radius to what the API allows, and says so', () => {
      const parsed = parse('within 100 km');

      expect(parsed.filters).toEqual({ radiusKm: 50 });
      expect(parsed.notes).toEqual(['The search radius is limited to 50 km; "within 100 km" was cut to that.']);
    });

    it('sets no radius for a distance of nothing, though it still asks where you are', () => {
      expect(parse('pizza within 0 km')).toMatchObject({ filters: { cuisine: ['Pizza'] }, locationWanted: true, notes: [] });
    });

    it('uses the first of several distances', () => {
      expect(filtersOf('within 2 km or within 5 km')).toEqual({ radiusKm: 2 });
    });

    it('does not take minutes for metres', () => {
      expect(parse('5 min walk').filters).toEqual({});
    });
  });

  describe('counts', () => {
    it.each([
      ['top 5', { limit: 5, sort: 'rating' }],
      ['5 best', { limit: 5, sort: 'rating' }],
      ['best 5', { limit: 5, sort: 'rating' }],
      ['first 3', { limit: 3 }],
      ['show me 10 restaurants', { limit: 10 }],
      ['3 places', { limit: 3 }],
      ['3 nearest', { limit: 3, sort: 'distance' }],
      ['cheapest 4', { limit: 4, sort: 'cost' }],
    ])('reads "%s"', (text, expected) => {
      expect(filtersOf(text)).toEqual(expected);
    });

    it('cuts a count to the largest page, and says so', () => {
      const parsed = parse('top 100');

      expect(parsed.filters).toEqual({ limit: 50, sort: 'rating' });
      expect(parsed.notes).toEqual(['At most 50 restaurants come back at a time; "top 100" was cut to that. Use offset for the next ones.']);
    });

    it('uses the first of several counts', () => {
      expect(filtersOf('top 3 pizza places, top 5')).toEqual({ cuisine: ['Pizza'], limit: 3, sort: 'rating' });
    });

    it('does not take a zero for a count', () => {
      expect(filtersOf('top 0')).toEqual({ sort: 'rating' });
    });
  });

  describe('words for the order', () => {
    it.each([
      ['best', { sort: 'rating' }],
      ['top rated', { sort: 'rating' }],
      ['highly-rated', { sort: 'rating' }],
      ['highest rated', { sort: 'rating' }],
      ['nearest', { sort: 'distance' }],
      ['closest', { sort: 'distance' }],
      ['cheapest', { sort: 'cost' }],
      ['cheap', { sort: 'cost' }],
      ['affordable', { sort: 'cost' }],
      ['most expensive', { sort: 'cost', order: 'desc' }],
      ['priciest', { sort: 'cost', order: 'desc' }],
      ['popular', { sort: 'votes' }],
      ['most popular', { sort: 'votes' }],
      ['most reviewed', { sort: 'votes' }],
    ])('reads "%s"', (text, expected) => {
      expect(filtersOf(text)).toEqual(expected);
    });

    it('applies only the first of several orders, and says which one it dropped', () => {
      const parsed = parse('best and cheapest pizza');

      expect(parsed.filters.sort).toBe('rating');
      expect(parsed.notes).toEqual(['Only one order can apply, so "cheapest" was ignored in favour of "best".']);
      expect(filtersOf('cheapest and best pizza').sort).toBe('cost');
    });

    it('does not read part of a longer word as an order word', () => {
      expect(parse('rooftop bar').words).toEqual(['rooftop', 'bar']);
      expect(filtersOf('rooftop bar')).toEqual({});
    });
  });

  describe('services', () => {
    it.each([
      ['with online delivery', { delivery: true }],
      ['home delivery', { delivery: true }],
      ['that deliver', { delivery: true }],
      ['without delivery', { delivery: false }],
      ['no online delivery', { delivery: false }],
      ['with table booking', { booking: true }],
      ['book a table', { booking: true }],
      ['reservations', { booking: true }],
      ['bookable', { booking: true }],
      ['without table booking', { booking: false }],
      ['that deliver and take bookings', { delivery: true, booking: true }],
    ])('reads "%s"', (text, expected) => {
      expect(filtersOf(text)).toEqual(expected);
    });

    it('uses the first of several, as for every other filter', () => {
      expect(filtersOf('with delivery or without delivery')).toEqual({ delivery: true });
      expect(filtersOf('without table booking, or with table booking')).toEqual({ booking: false });
    });
  });

  describe('what the data cannot answer', () => {
    it.each(['open now', 'open late', 'open 24 hours', 'open 24x7', 'open on sundays', 'late night'])(
      'says that "%s" is ignored because there are no opening hours',
      (phrase) => {
        const parsed = parse(`pizza ${phrase}`);

        expect(parsed.filters).toEqual({ cuisine: ['Pizza'] });
        expect(parsed.words).toEqual([]);
        expect(parsed.notes).toEqual([`Opening hours are not in the data, so "${phrase}" was ignored.`]);
      },
    );

    it('says so when nothing in the text means anything', () => {
      expect(parse('restaurants').notes).toEqual([
        'Nothing in the text was recognised as a place, cuisine or filter, so no filter was applied.',
      ]);
      expect(parse('').notes).toHaveLength(1);
    });
  });

  describe('near me', () => {
    it.each(['near me', 'nearby', 'close to me', 'around here', 'close by'])(
      'reads "%s" as within 5 km, says so, and wants a location',
      (phrase) => {
        expect(parse(`pizza ${phrase}`)).toEqual({
          filters: { cuisine: ['Pizza'], radiusKm: 5 },
          words: [],
          locationWanted: true,
          notes: [`"${phrase}" was read as within 5 km.`],
          priceNotes: [],
          radiusNotes: [`"${phrase}" was read as within 5 km.`],
        });
      },
    );

    it('is the same 5 km as the constant, so the two cannot drift apart', () => {
      expect(NEAR_ME_KM).toBe(5);
      expect(parse('nearby').filters.radiusKm).toBe(NEAR_ME_KM);
    });

    it('keeps the order words: "top 5 pizza places near me" is the best rated within 5 km', () => {
      expect(parse('top 5 pizza places near me').filters).toEqual({
        cuisine: ['Pizza'],
        sort: 'rating',
        limit: 5,
        radiusKm: 5,
      });
    });

    it('gives way to a distance in the sentence, which is the more exact', () => {
      const parsed = parse('pizza within 2 km near me');

      expect(parsed.filters).toEqual({ cuisine: ['Pizza'], radiusKm: 2 });
      expect(parsed.notes).toEqual([]);
      expect(parsed.radiusNotes).toEqual([]);
      expect(parse('pizza near me within 12 km').filters.radiusKm).toBe(12);
    });

    it('sets no radius for the nearest: it is the nearest one wherever it is', () => {
      for (const sentence of ['nearest pizza near me', 'pizza nearby, closest first']) {
        const parsed = parse(sentence);

        expect(parsed.filters).toEqual({ cuisine: ['Pizza'], sort: 'distance' });
        expect(parsed.notes).toEqual([]);
        expect(parsed.locationWanted).toBe(true);
      }
    });

    it('reads it once, though it is said twice', () => {
      const parsed = parse('pizza near me and nearby');

      expect(parsed.filters).toEqual({ cuisine: ['Pizza'], radiusKm: 5 });
      expect(parsed.notes).toEqual(['"near me" was read as within 5 km.']);
    });

    it('keeps the note of a radius that was cut, apart from the other notes', () => {
      const parsed = parse('pizza within 100 km open now');

      expect(parsed.notes).toHaveLength(2);
      expect(parsed.radiusNotes).toEqual(['The search radius is limited to 50 km; "within 100 km" was cut to that.']);
    });
  });

  describe('the words that are left', () => {
    it('keeps what is not a place, cuisine or filter, lower case, in order and once each', () => {
      expect(parse('Vada Pav vada').words).toEqual(['vada', 'pav']);
    });

    it('drops filler such as articles, prepositions and "restaurants"', () => {
      expect(parse('Show me the best restaurants in the city please').words).toEqual(['city']);
      expect(parse('a place for two near the park').words).toEqual(['park']);
    });

    it('keeps single digits too: "Phase 3" is not "Phase"', () => {
      expect(parse('Phase 3').words).toEqual(['phase', '3']);
    });

    it('reads full-width letters and digits like plain ones', () => {
      expect(filtersOf('ＰＩＺＺＡ under ₹１０００')).toEqual({ cuisine: ['Pizza'], maxCost: 999, currency: 'INR' });
    });

    it('keeps numbers, so that a locality such as "Sector 29" can be found', () => {
      expect(parse('Sector 29 Gurgaon')).toMatchObject({ filters: { city: 'Gurgaon' }, words: ['sector', '29'] });
    });

    it('keeps accents and apostrophes as they were typed, because names have them', () => {
      expect(parse("Domino's").words).toEqual(["domino's"]);
      expect(parse('crêperie').words).toEqual(['crêperie']);
    });

    it('drops single letters', () => {
      expect(parse('x y z pav').words).toEqual(['pav']);
    });

    it(`uses at most ${MAX_TEXT_WORDS} words and says which it left out`, () => {
      const parsed = parse('alpha bravo charlie delta echo foxtrot golf hotel');

      expect(parsed.words).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']);
      expect(parsed.notes[0]).toBe('Only the first 6 unrecognised words are used; "golf", "hotel" was left out.');
    });

    it('never turns text into a pattern: it is handed on as plain words', () => {
      expect(parse('.* (bar) [main]').words).toEqual(['bar', 'main']);
    });
  });

  describe('robustness', () => {
    const nasty = [
      '',
      '   ',
      'a'.repeat(200),
      '9'.repeat(200),
      '₹'.repeat(200),
      '-'.repeat(200),
      '1 '.repeat(100),
      'rs '.repeat(66),
      'under '.repeat(33),
      'between 1 and 2 '.repeat(12),
      'top 5 '.repeat(33),
      'rated 4.5 stars '.repeat(12),
      '😀 '.repeat(100),
      '((((((((((((((((((((((((((((((',
      '\u0000\u0001 control \u007f',
      'İstanbul ǅ ß ﬁ ㎏',
    ];

    it.each(nasty.map((text) => [text.slice(0, 20)] as const))('reads %j without failing', (prefix) => {
      const text = nasty.find((candidate) => candidate.startsWith(prefix)) ?? '';
      expect(() => parse(text)).not.toThrow();
    });

    it('reads the longest sentence the API accepts in well under a second', () => {
      for (const text of nasty) {
        const started = performance.now();
        parse(text.slice(0, 200));
        expect(performance.now() - started).toBeLessThan(500);
      }
    });

    it('only ever produces parameters that GET /v1/restaurants accepts', () => {
      // A fixed pseudo-random generator, so a failure can be reproduced.
      let seed = 20260711;
      const random = (limit: number) => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed % limit;
      };
      const fragments = [
        'best', 'cheapest', 'nearest', 'top 5', 'top 500', '3 nearest', 'within 7 km', 'within 900 km',
        'under Rs. 1000 for two', 'over 300', 'between 100 and 50', 'at least $12', 'under 9999999999',
        'rated above 4.5', 'rated 9', '4 stars', 'with online delivery', 'without table booking',
        'in Gurgaon', 'Gurugram', 'Delhi', 'India', 'UK', 'south indian', 'pizza', 'burgers', 'coffee and tea',
        'vada pav', "domino's", 'near me', 'open now', 'per person', 'for two', '1.5k', '2 thousand', '###', '%%',
      ];
      for (let round = 0; round < 400; round += 1) {
        const text = Array.from({ length: 1 + random(6) }, () => fragments[random(fragments.length)]).join(' ');
        const { filters } = parse(text);

        const query: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(filters)) {
          query[key] = Array.isArray(value) ? value : String(value);
        }
        const result = listQuerySchema.safeParse(query);

        // lat and lng are never in the text; the rules that need them are the search's to check.
        const problems = result.success ? [] : result.error.issues.filter((issue) => !['sort', 'radiusKm'].includes(String(issue.path[0])));
        expect({ text, problems }).toEqual({ text, problems: [] });
      }
    });
  });
});
