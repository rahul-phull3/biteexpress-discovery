import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadTextFixes,
  parseTextFixes,
  TEXT_FIELD_COLUMNS,
  TEXT_FIELDS,
} from './text-fixes';

describe('parseTextFixes', () => {
  it('turns a valid object into a map by restaurant id', () => {
    const fixes = parseTextFixes({
      '6601005': { name: 'Café Daniel Briand', city: 'Brasília' },
      '18460280': { name: 'M Crème' },
    });

    expect(fixes.size).toBe(2);
    expect(fixes.get('6601005')).toEqual({
      name: 'Café Daniel Briand',
      city: 'Brasília',
    });
    expect(fixes.get('18460280')?.name).toBe('M Crème');
    expect(fixes.get('1')).toBeUndefined();
  });

  it('accepts an empty file: nothing to fix', () => {
    expect(parseTextFixes({}).size).toBe(0);
  });

  it('rejects a key that is not a restaurant id, and names it', () => {
    expect(() => parseTextFixes({ 'not-an-id': { name: 'x' } })).toThrow(
      'not-an-id',
    );
  });

  it('rejects a fix that changes nothing', () => {
    expect(() => parseTextFixes({ '1': {} })).toThrow('at least one of');
  });

  it('rejects a field the importer does not repair', () => {
    expect(() => parseTextFixes({ '1': { cuisines: 'Cafe' } })).toThrow();
  });

  it('rejects a value that is not text', () => {
    expect(() => parseTextFixes({ '1': { name: 42 } })).toThrow();
  });

  it('rejects something that is not an object', () => {
    expect(() => parseTextFixes([])).toThrow();
    expect(() => parseTextFixes('fixes')).toThrow();
    expect(() => parseTextFixes(null)).toThrow();
  });

  it('names the source in the error', () => {
    expect(() => parseTextFixes([], '"data/text-fixes.json"')).toThrow(
      '"data/text-fixes.json" is not valid',
    );
  });
});

describe('TEXT_FIELD_COLUMNS', () => {
  it('names the CSV column of every repairable text field', () => {
    expect(TEXT_FIELDS).toEqual(['name', 'address', 'city', 'locality']);
    expect(TEXT_FIELD_COLUMNS).toEqual({
      name: 'Restaurant Name',
      address: 'Address',
      city: 'City',
      locality: 'Locality',
    });
  });
});

describe('loadTextFixes', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'text-fixes-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads and validates a file', async () => {
    const path = join(directory, 'good.json');
    await writeFile(path, JSON.stringify({ '7': { name: 'Filé de Ouro' } }));

    const fixes = await loadTextFixes(path);

    expect(fixes.get('7')).toEqual({ name: 'Filé de Ouro' });
  });

  it('says where the file should be and how to rebuild it when it is missing', async () => {
    await expect(
      loadTextFixes(join(directory, 'missing.json')),
    ).rejects.toThrow('npm run import:fixes');
  });

  it('says so when the file is not JSON', async () => {
    const path = join(directory, 'broken.json');
    await writeFile(path, '{ not json');

    await expect(loadTextFixes(path)).rejects.toThrow('is not valid JSON');
  });

  it('says so when the JSON has the wrong shape', async () => {
    const path = join(directory, 'wrong.json');
    await writeFile(path, JSON.stringify({ '1': {} }));

    await expect(loadTextFixes(path)).rejects.toThrow('at least one of');
  });
});
