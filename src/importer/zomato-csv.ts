import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { describeError } from '../database/mongo-errors';

/**
 * The columns of zomato.csv that the importer reads. The other four are left
 * out on purpose: Currency (unreliable, derived from the country instead),
 * Rating color (follows from the rating), Locality Verbose (Locality plus City)
 * and Switch to order menu (the same value in every row).
 */
export const ZOMATO_COLUMNS = [
  'Restaurant ID',
  'Restaurant Name',
  'Country Code',
  'City',
  'Address',
  'Locality',
  'Longitude',
  'Latitude',
  'Cuisines',
  'Average Cost for two',
  'Has Table booking',
  'Has Online delivery',
  'Is delivering now',
  'Price range',
  'Aggregate rating',
  'Rating text',
  'Votes',
] as const;

export type ZomatoColumn = (typeof ZOMATO_COLUMNS)[number];

/** One CSV row: the columns above, as the text found in the file. */
export type ZomatoRow = Record<ZomatoColumn, string>;

/**
 * Turns the text of zomato.csv into rows. A real CSV parser is needed because
 * addresses are quoted, contain commas, and six of them contain a raw line
 * break. A short row (or a long one) is an error, not something to guess at.
 */
export function parseZomatoCsv(text: string): ZomatoRow[] {
  let records: string[][];
  try {
    records = parse(text, { skip_empty_lines: true });
  } catch (error) {
    throw new Error(`The CSV could not be parsed: ${describeError(error)}`, {
      cause: error,
    });
  }

  const [header, ...body] = records;
  if (!header) {
    throw new Error('The CSV is empty: it has no header row.');
  }
  const positions = ZOMATO_COLUMNS.map((column) => ({
    column,
    position: header.indexOf(column),
  }));
  const missing = positions
    .filter(({ position }) => position === -1)
    .map(({ column }) => column);
  if (missing.length > 0) {
    throw new Error(
      `The CSV is missing the column(s) ${missing.map((m) => `"${m}"`).join(', ')}. ` +
        `Its header is: ${header.join(', ')}`,
    );
  }

  return body.map(
    (fields) =>
      Object.fromEntries(
        positions.map(({ column, position }) => [
          column,
          fields[position] ?? '',
        ]),
      ) as ZomatoRow,
  );
}

/**
 * Reads zomato.csv. The file is not valid UTF-8, so it is read as latin1,
 * where every byte becomes exactly one character and nothing is lost or
 * invented. (Damaged text is repaired later, from text-fixes.json.)
 */
export async function readZomatoCsv(path: string): Promise<ZomatoRow[]> {
  let text: string;
  try {
    text = await readFile(path, 'latin1');
  } catch (error) {
    throw new Error(
      `Could not read the CSV file "${path}": ${describeError(error)}`,
      {
        cause: error,
      },
    );
  }
  return parseZomatoCsv(text);
}
