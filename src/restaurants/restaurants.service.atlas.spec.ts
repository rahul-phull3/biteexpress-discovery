import { InMemoryRestaurantStore } from '../../test/support/in-memory-restaurant-store';
import { createRestaurantSchema } from './create-restaurant.schema';
import { searchQuerySchema } from './list-query.schema';
import { RestaurantsService } from './restaurants.service';
import { RulesTextSearch, type TextSearch } from './text-search';
import { VocabularyService } from './vocabulary.service';

// How the search matches the leftover words of a sentence: through Atlas
// Search when it answers, as plain text when it does not, and how it says which.

const TENANT = 'atlas-spec';
const SENTENCE = 'Nearest place that serves Vada Pav';
/** Cyber Hub, Gurgaon: where the person stands. */
const HERE = { lat: '28.495', lng: '77.089' };

type Answer = (words: readonly string[]) => Promise<string[] | null>;

/** A TextSearch that says it is Atlas Search, answers as it is told, and remembers what it was asked. */
function fakeAtlas() {
  const asked: Array<{ tenantId: string; words: readonly string[] }> = [];
  let answer: Answer = async () => [];
  const engine: TextSearch = {
    engine: 'atlas',
    candidates: async (tenantId, words) => {
      asked.push({ tenantId, words });
      return answer(words);
    },
  };
  return {
    engine,
    asked,
    /** What Atlas Search will answer from now on. */
    answers: (next: Answer) => {
      answer = next;
    },
  };
}

async function seededService(engine?: TextSearch) {
  const store = new InMemoryRestaurantStore();
  const vocabulary = new VocabularyService(store);
  const service =
    engine === undefined
      ? new RestaurantsService(store, vocabulary)
      : new RestaurantsService(store, vocabulary, engine);
  const create = (body: object) => service.create(TENANT, createRestaurantSchema.parse(body));

  const junction = await create({
    name: 'Vada Pav Junction',
    address: { locality: 'Cyber Hub', city: 'Gurgaon', countryCode: 'IN' },
    location: { latitude: 28.46, longitude: 77.03 },
    cuisines: ['Fast Food'],
  });
  const goli = await create({
    name: 'Goli Vada Pav No. 1',
    address: { city: 'New Delhi', countryCode: 'IN' },
    location: { latitude: 28.6315, longitude: 77.2167 },
    cuisines: ['Street Food'],
  });
  await create({
    name: 'Dosa Corner',
    address: { city: 'Gurgaon', countryCode: 'IN' },
    cuisines: ['South Indian'],
  });
  return { service, junction, goli };
}

const namesOf = (response: { data: Array<{ name: string }> }) => response.data.map((item) => item.name);
const request = (q: string, extra: Record<string, string> = HERE) => searchQuerySchema.parse({ q, ...extra });

describe('RestaurantsService.search, with Atlas Search', () => {
  it('lists only the restaurants that Atlas Search named, and says so', async () => {
    const atlas = fakeAtlas();
    const { service, junction } = await seededService(atlas.engine);
    atlas.answers(async () => [junction.id]);

    const response = await service.search(TENANT, request(SENTENCE));

    // The plain rules would have listed Goli Vada Pav No. 1 as well; Atlas Search did not name it.
    expect(namesOf(response)).toEqual(['Vada Pav Junction']);
    expect(atlas.asked).toEqual([{ tenantId: TENANT, words: ['vada', 'pav'] }]);
    expect(response.interpretation.textSearch).toEqual({ engine: 'atlas', degraded: false });
    expect(response.interpretation.notes.join(' ')).toContain('matched by Atlas Search');
    expect(response.interpretation.words).toEqual(['vada', 'pav']);
    expect(response.interpretation.summary).toContain('"vada pav" in the name or area');
  });

  it('puts what it named in the order of the sentence, not in the order that Atlas Search ranked it', async () => {
    const atlas = fakeAtlas();
    const { service, junction, goli } = await seededService(atlas.engine);
    atlas.answers(async () => [goli.id, junction.id]);

    const response = await service.search(TENANT, request(SENTENCE));

    // "Nearest": about 7 km away, then about 20 km.
    expect(namesOf(response)).toEqual(['Vada Pav Junction', 'Goli Vada Pav No. 1']);
    expect(response.data[0]?.distanceKm).toBeCloseTo(6.97, 1);
    expect(response.data[1]?.distanceKm).toBeCloseTo(19.67, 1);
  });

  it('still applies the other filters of the request to what it named', async () => {
    const atlas = fakeAtlas();
    const { service, junction, goli } = await seededService(atlas.engine);
    atlas.answers(async () => [goli.id, junction.id]);

    const response = await service.search(TENANT, request(SENTENCE, { ...HERE, city: 'New Delhi' }));

    expect(namesOf(response)).toEqual(['Goli Vada Pav No. 1']);
  });

  it('finds nothing, and says why, when Atlas Search names no restaurant', async () => {
    const atlas = fakeAtlas();
    const { service } = await seededService(atlas.engine);
    atlas.answers(async () => []);

    const response = await service.search(TENANT, request(SENTENCE));

    expect(response.data).toEqual([]);
    expect(response.interpretation.textSearch).toEqual({ engine: 'atlas', degraded: false });
    expect(response.interpretation.notes.join(' ')).toContain('No restaurant has all of these words');
  });

  it.each([
    { how: 'cannot answer', answer: async (): Promise<string[] | null> => null },
    {
      how: 'throws',
      answer: async (): Promise<string[] | null> => {
        throw new Error('mongot is down');
      },
    },
  ])('matches the words as plain text, and says it did, when Atlas Search $how', async ({ answer }) => {
    const atlas = fakeAtlas();
    const { service } = await seededService(atlas.engine);
    atlas.answers(answer);

    const response = await service.search(TENANT, request(SENTENCE));

    expect(namesOf(response)).toEqual(['Vada Pav Junction', 'Goli Vada Pav No. 1']);
    expect(response.interpretation.textSearch).toEqual({ engine: 'rules', degraded: true });
    expect(response.interpretation.notes.join(' ')).toContain('matched as plain text');
    expect(response.interpretation.summary).toContain('"vada pav" in the name or area');
  });

  it('does not ask Atlas Search when the sentence leaves no words', async () => {
    const atlas = fakeAtlas();
    const { service } = await seededService(atlas.engine);

    const response = await service.search(TENANT, request('Best restaurants in Gurgaon with South Indian Food', {}));

    expect(response.interpretation.words).toEqual([]);
    expect(atlas.asked).toEqual([]);
    expect(response.interpretation).not.toHaveProperty('textSearch');
  });

  it('does not ask Atlas Search when the request has no sentence', async () => {
    const atlas = fakeAtlas();
    const { service } = await seededService(atlas.engine);

    const response = await service.search(TENANT, searchQuerySchema.parse({ city: 'Gurgaon' }));

    expect(atlas.asked).toEqual([]);
    expect(response.interpretation).not.toHaveProperty('textSearch');
  });
});

describe('RestaurantsService.search, with the plain rules', () => {
  it.each([
    { how: 'is told to use the rules', engine: () => new RulesTextSearch() },
    { how: 'is given no engine at all', engine: () => undefined },
  ])('matches the words as plain text, and says nothing about it, when the service $how', async ({ engine }) => {
    const { service } = await seededService(engine());

    const response = await service.search(TENANT, request(SENTENCE));

    expect(namesOf(response)).toEqual(['Vada Pav Junction', 'Goli Vada Pav No. 1']);
    expect(response.interpretation).not.toHaveProperty('textSearch');
    expect(response.interpretation.summary).toContain('"vada pav" in the name or area');
  });
});
