import {
  restaurantsSearchDefinition,
  SEARCH_INDEX_NAME,
} from '../database/restaurants.collection';
import {
  buildTextSearchPipeline,
  FUZZY_MIN_LENGTH,
  TEXT_SEARCH_CANDIDATE_LIMIT,
} from './atlas-text-query';

type Obj = Record<string, any>;

const pipelineFor = (words: string[], tenant = 't1') => buildTextSearchPipeline(tenant, words);
const searchStage = (words: string[]): Obj => pipelineFor(words)[0]?.$search as Obj;
const wordClauses = (words: string[]): Obj[] => searchStage(words).compound.must as Obj[];
/** The `text` operator of the clause of a word. */
const textOf = (word: string): Obj => wordClauses([word])[0]?.compound.should[0].text as Obj;

describe('buildTextSearchPipeline', () => {
  it('starts with $search on the restaurants_search index: that stage must come first', () => {
    const [first] = pipelineFor(['vada']);

    expect(Object.keys(first ?? {})).toEqual(['$search']);
    expect(searchStage(['vada']).index).toBe(SEARCH_INDEX_NAME);
  });

  it("limits the search to the tenant's active restaurants with filters, which do not change the ranking", () => {
    expect(searchStage(['vada']).compound.filter).toEqual([
      { equals: { path: 'tenantId', value: 't1' } },
      { equals: { path: 'status', value: 'active' } },
    ]);
    expect(buildTextSearchPipeline('t2', ['vada'])[0]?.$search.compound.filter[0]).toEqual({
      equals: { path: 'tenantId', value: 't2' },
    });
  });

  it('requires every word: one clause each, in the order of the sentence', () => {
    const clauses = wordClauses(['vada', 'pav', 'junction']);

    expect(clauses).toHaveLength(3);
    expect(clauses.map((clause) => clause.compound.should[1].autocomplete.query)).toEqual([
      'vada',
      'pav',
      'junction',
    ]);
  });

  it('lets a word fit as a whole word, or as the start of a longer one, in the name or in the area', () => {
    expect(wordClauses(['pav'])[0]).toEqual({
      compound: {
        should: [
          { text: { query: 'pav', path: ['name', 'address.locality'] } },
          { autocomplete: { query: 'pav', path: 'name' } },
          { autocomplete: { query: 'pav', path: 'address.locality' } },
        ],
        minimumShouldMatch: 1,
      },
    });
  });

  it(`allows one typo only in a word of ${FUZZY_MIN_LENGTH} letters or more`, () => {
    const short = 'a'.repeat(FUZZY_MIN_LENGTH - 1);
    const long = 'a'.repeat(FUZZY_MIN_LENGTH);

    expect(textOf(short)).not.toHaveProperty('fuzzy');
    expect(textOf(long).fuzzy).toEqual({ maxEdits: 1, prefixLength: 1 });
  });

  it('passes a word through as it is, never as a pattern', () => {
    const [clause] = wordClauses(['(bar)', '.*']);

    expect(clause?.compound.should[0].text.query).toBe('(bar)');
    expect(wordClauses(['(bar)', '.*'])[1]?.compound.should[0].text.query).toBe('.*');
  });

  it('keeps the best matches, at most the limit, and returns nothing but their ids', () => {
    const pipeline = pipelineFor(['vada']);

    expect(pipeline.slice(1)).toEqual([
      { $limit: TEXT_SEARCH_CANDIDATE_LIMIT },
      { $project: { _id: 1 } },
    ]);
    expect(buildTextSearchPipeline('t1', ['vada'], 7)[1]).toEqual({ $limit: 7 });
  });
});

describe('the query and the index definition', () => {
  const fields = (restaurantsSearchDefinition.mappings as Obj).fields as Obj;

  /** The index types that a path has in the definition: "name" is a string and an autocomplete field. */
  function typesAt(path: string): string[] {
    let definitions: Obj[] = [{ type: 'document', fields }];
    for (const part of path.split('.')) {
      definitions = definitions.flatMap((definition) => {
        const child = (definition.fields as Obj | undefined)?.[part];
        return child === undefined ? [] : ([] as Obj[]).concat(child);
      });
    }
    return definitions.map((definition) => definition.type as string);
  }

  /** Which index type each operator needs on the path it searches. */
  const NEEDS: Record<string, string> = { text: 'string', autocomplete: 'autocomplete', equals: 'token' };

  function operatorsIn(node: unknown, found: Array<{ operator: string; path: string }> = []) {
    if (Array.isArray(node)) {
      node.forEach((item) => operatorsIn(item, found));
    } else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key in NEEDS && value !== null && typeof value === 'object' && 'path' in value) {
          for (const path of ([] as string[]).concat((value as Obj).path)) {
            found.push({ operator: key, path });
          }
        } else {
          operatorsIn(value, found);
        }
      }
    }
    return found;
  }

  it('searches only fields, with only index types, that restaurantsSearchDefinition has', () => {
    const used = operatorsIn(searchStage(['vada', 'pavbhaji']));

    expect(used.length).toBeGreaterThanOrEqual(10);
    for (const { operator, path } of used) {
      expect({ operator, path, types: typesAt(path) }).toEqual({
        operator,
        path,
        types: expect.arrayContaining([NEEDS[operator]]),
      });
    }
  });
});
