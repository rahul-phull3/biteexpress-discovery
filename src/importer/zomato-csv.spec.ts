import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  csvOf,
  FULL_HEADER,
  zomatoCsv,
  zomatoRow,
} from '../../test/support/zomato-rows';
import { parseZomatoCsv, readZomatoCsv, ZOMATO_COLUMNS } from './zomato-csv';

describe('parseZomatoCsv', () => {
  it('turns each record into an object keyed by column name', () => {
    const rows = parseZomatoCsv(zomatoCsv([zomatoRow()]));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(zomatoRow());
  });

  it('reads only the columns the importer needs', () => {
    const [row] = parseZomatoCsv(zomatoCsv([zomatoRow()]));

    expect(Object.keys(row)).toEqual([...ZOMATO_COLUMNS]);
  });

  it('finds columns by name, wherever they are', () => {
    const header = [...FULL_HEADER].reverse();
    const record = header.map((column) =>
      column === 'Restaurant Name' ? 'Reversed Cafe' : 'x',
    );

    const [row] = parseZomatoCsv(csvOf([header, record]));

    expect(row['Restaurant Name']).toBe('Reversed Cafe');
  });

  it('keeps commas, doubled quotes and line breaks inside a quoted field', () => {
    const address = 'Shop 1, "Main" Road,\rNear the Park';
    const [row] = parseZomatoCsv(zomatoCsv([zomatoRow({ Address: address })]));

    expect(row.Address).toBe(address);
  });

  it('reads files that end in a single line feed or have no final line break', () => {
    const text = zomatoCsv([zomatoRow()]);

    expect(parseZomatoCsv(text.replace(/\r\n/g, '\n'))).toHaveLength(1);
    expect(parseZomatoCsv(text.trimEnd())).toHaveLength(1);
  });

  it('skips empty lines', () => {
    const text = zomatoCsv([zomatoRow(), zomatoRow({ 'Restaurant ID': '2' })]);

    const rows = parseZomatoCsv(`\r\n${text.replace('\r\n', '\r\n\r\n')}\r\n`);

    expect(rows.map((row) => row['Restaurant ID'])).toEqual(['308022', '2']);
  });

  it('gives a header-only file no rows', () => {
    expect(parseZomatoCsv(zomatoCsv([]))).toEqual([]);
  });

  it('names the missing columns and shows the header it found', () => {
    const text = csvOf([
      ['Restaurant ID', 'Restaurant Name'],
      ['1', 'Cafe'],
    ]);

    expect(() => parseZomatoCsv(text)).toThrow(
      'missing the column(s) "Country Code"',
    );
    expect(() => parseZomatoCsv(text)).toThrow(
      'Its header is: Restaurant ID, Restaurant Name',
    );
  });

  it('rejects an empty file', () => {
    expect(() => parseZomatoCsv('')).toThrow('The CSV is empty');
  });

  it('rejects a record with the wrong number of fields instead of guessing', () => {
    const text = `${zomatoCsv([zomatoRow()])}1,only,three\r\n`;

    expect(() => parseZomatoCsv(text)).toThrow('The CSV could not be parsed');
  });

  it('rejects a quote that is never closed', () => {
    const text = `${zomatoCsv([])}"unclosed,field\r\n`;

    expect(() => parseZomatoCsv(text)).toThrow('The CSV could not be parsed');
  });

  it('rejects a stray quote inside an unquoted field', () => {
    // Written by hand: csvOf would have quoted the field properly.
    const unquoted = FULL_HEADER.map((column) =>
      column === 'Restaurant Name' ? 'Pizza "Hut"' : 'x',
    ).join(',');
    const text = `${zomatoCsv([])}${unquoted}\r\n`;

    expect(() => parseZomatoCsv(text)).toThrow('The CSV could not be parsed');
  });
});

describe('readZomatoCsv', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zomato-csv-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads a file byte for byte as latin1, so no byte is lost or invented', async () => {
    const path = join(directory, 'latin1.csv');
    // 0xE9 is "é" in Latin-1 and not valid UTF-8 on its own.
    await writeFile(
      path,
      Buffer.from(
        zomatoCsv([zomatoRow({ 'Restaurant Name': 'Café' })]),
        'latin1',
      ),
    );

    const [row] = await readZomatoCsv(path);

    expect(row['Restaurant Name']).toBe('Café');
  });

  it('keeps the bytes of text that is already damaged', async () => {
    const path = join(directory, 'damaged.csv');
    await writeFile(
      path,
      Buffer.from(
        zomatoCsv([zomatoRow({ 'Restaurant Name': 'Cafí©' })]),
        'latin1',
      ),
    );

    const [row] = await readZomatoCsv(path);

    expect(row['Restaurant Name']).toBe('Cafí©');
  });

  it('names the file when it cannot be read', async () => {
    const path = join(directory, 'missing.csv');

    await expect(readZomatoCsv(path)).rejects.toThrow(
      `Could not read the CSV file "${path}"`,
    );
  });
});
