import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectReferenceTexts,
  createReferenceTexts,
  readReferenceTexts,
  type ReferenceText,
} from './dump-text';

const API_KEY = 'SECRET-API-KEY-0123456789';

/** One restaurant record as the Zomato API dump has it: the four texts plus fields we must not keep. */
function record(id: number, text: Partial<ReferenceText> = {}) {
  return {
    restaurant: {
      R: { res_id: id },
      apikey: API_KEY,
      id: String(id),
      name: text.name ?? 'Farzi Cafe',
      cuisines: 'Modern Indian',
      location: {
        address: text.address ?? '7-8, Cyber Hub',
        city: text.city ?? 'Gurgaon',
        locality: text.locality ?? 'Cyber Hub',
        latitude: '28.4952079',
        longitude: '77.0886879',
      },
    },
  };
}

const page = (...restaurants: ReturnType<typeof record>[]) => ({
  results_found: restaurants.length,
  restaurants,
});

describe('collectReferenceTexts', () => {
  it('collects name, address, city and locality by restaurant id', () => {
    const into = createReferenceTexts();

    collectReferenceTexts([page(record(308022))], into);

    expect(into.byId.get('308022')).toEqual({
      name: 'Farzi Cafe',
      address: '7-8, Cyber Hub',
      city: 'Gurgaon',
      locality: 'Cyber Hub',
    });
  });

  it('keeps nothing else, in particular never the API key', () => {
    const into = createReferenceTexts();

    collectReferenceTexts([page(record(1), record(2))], into);

    const kept = JSON.stringify([...into.byId.values()]);
    expect(kept).not.toContain(API_KEY);
    expect(kept).not.toContain('apikey');
    expect(kept).not.toContain('Modern Indian');
    expect(kept).not.toContain('28.4952079');
  });

  it('accepts pages that have no restaurants', () => {
    const into = createReferenceTexts();

    collectReferenceTexts([{ results_found: 0 }, {}, page(record(1))], into);

    expect([...into.byId.keys()]).toEqual(['1']);
    expect(into.records).toBe(1);
  });

  it('counts every record but keeps one text per restaurant', () => {
    const into = createReferenceTexts();

    collectReferenceTexts([page(record(1), record(1)), page(record(1))], into);

    expect(into.records).toBe(3);
    expect(into.byId.size).toBe(1);
    expect([...into.conflictingIds]).toEqual([]);
  });

  it('does not call a repeat with different whitespace a conflict', () => {
    const into = createReferenceTexts();

    collectReferenceTexts(
      [
        page(
          record(1, { name: 'Farzi  Cafe' }),
          record(1, { name: ' Farzi Cafe ' }),
        ),
      ],
      into,
    );

    expect(into.conflictingIds.size).toBe(0);
  });

  it('reports a restaurant whose repeats disagree, and keeps the first text', () => {
    const into = createReferenceTexts();

    collectReferenceTexts(
      [
        page(
          record(1, { name: 'First' }),
          record(1, { name: 'Second' }),
          record(2),
        ),
      ],
      into,
    );

    expect([...into.conflictingIds]).toEqual(['1']);
    expect(into.byId.get('1')?.name).toBe('First');
  });

  it('collects across several calls, as it does for several files', () => {
    const into = createReferenceTexts();

    collectReferenceTexts([page(record(1))], into);
    collectReferenceTexts([page(record(2))], into);

    expect([...into.byId.keys()].sort()).toEqual(['1', '2']);
  });

  it('rejects JSON that is not a list of pages, naming the file', () => {
    expect(() =>
      collectReferenceTexts(
        { restaurants: [] },
        createReferenceTexts(),
        '"file1.json"',
      ),
    ).toThrow('"file1.json" does not look like a Zomato API dump');
  });

  it('points at the part of a record that is wrong', () => {
    const broken = record(1);
    delete (broken.restaurant as Partial<typeof broken.restaurant>).location;

    expect(() =>
      collectReferenceTexts([page(broken)], createReferenceTexts()),
    ).toThrow('restaurant.location');
  });

  it('rejects a restaurant id that is not a whole number', () => {
    const broken = record(1);
    (broken.restaurant.R as { res_id: unknown }).res_id = '12';

    expect(() =>
      collectReferenceTexts([page(broken)], createReferenceTexts()),
    ).toThrow('res_id');
  });
});

describe('readReferenceTexts', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dump-text-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('merges the restaurants of several files', async () => {
    const first = join(directory, 'file1.json');
    const second = join(directory, 'file2.json');
    await writeFile(
      first,
      JSON.stringify([page(record(1), record(2))]),
      'utf8',
    );
    await writeFile(
      second,
      JSON.stringify([page(record(2), record(3))]),
      'utf8',
    );

    const gathered = await readReferenceTexts([first, second]);

    expect([...gathered.byId.keys()].sort()).toEqual(['1', '2', '3']);
    expect(gathered.records).toBe(4);
  });

  it('names a file that is not valid JSON', async () => {
    const path = join(directory, 'broken.json');
    await writeFile(path, '[ not json', 'utf8');

    await expect(readReferenceTexts([path])).rejects.toThrow(
      `Could not read the dump "${path}"`,
    );
  });

  it('names a file that is missing', async () => {
    const path = join(directory, 'missing.json');

    await expect(readReferenceTexts([path])).rejects.toThrow(
      `Could not read the dump "${path}"`,
    );
  });
});
