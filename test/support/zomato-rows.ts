import {
  ZOMATO_COLUMNS,
  type ZomatoColumn,
  type ZomatoRow,
} from '../../src/importer/zomato-csv';

/**
 * A valid CSV row (Farzi Cafe, Gurgaon) as the importer sees it, with any
 * field replaced by the test that needs a different one.
 */
export function zomatoRow(overrides: Partial<ZomatoRow> = {}): ZomatoRow {
  return {
    'Restaurant ID': '308022',
    'Restaurant Name': 'Farzi Cafe',
    'Country Code': '1',
    City: 'Gurgaon',
    Address: '7-8, Ground Floor, Cyber Hub, DLF Cyber City, Gurgaon',
    Locality: 'Cyber Hub, DLF Cyber City',
    Longitude: '77.0886879',
    Latitude: '28.4952079',
    Cuisines: 'Modern Indian',
    'Average Cost for two': '2200',
    'Has Table booking': 'No',
    'Has Online delivery': 'No',
    'Is delivering now': 'No',
    'Price range': '4',
    'Aggregate rating': '4.3',
    'Rating text': 'Very Good',
    Votes: '4385',
    ...overrides,
  };
}

/** The 21 columns of the real zomato.csv, in the real order. */
export const FULL_HEADER = [
  'Restaurant ID',
  'Restaurant Name',
  'Country Code',
  'City',
  'Address',
  'Locality',
  'Locality Verbose',
  'Longitude',
  'Latitude',
  'Cuisines',
  'Average Cost for two',
  'Currency',
  'Has Table booking',
  'Has Online delivery',
  'Is delivering now',
  'Switch to order menu',
  'Price range',
  'Aggregate rating',
  'Rating color',
  'Rating text',
  'Votes',
] as const;

/** One CSV field: quoted when it holds a comma, a quote or a line break, with quotes doubled. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV text for the given records: CRLF between records, as in zomato.csv. */
export function csvOf(records: readonly (readonly string[])[]): string {
  return `${records.map((record) => record.map(csvField).join(',')).join('\r\n')}\r\n`;
}

const READ_COLUMNS: readonly string[] = ZOMATO_COLUMNS;

/**
 * CSV text with all 21 columns of the real file for the given rows. The four
 * columns the importer ignores are filled with a placeholder.
 */
export function zomatoCsv(rows: readonly ZomatoRow[]): string {
  return csvOf([
    FULL_HEADER,
    ...rows.map((row) =>
      FULL_HEADER.map((column) =>
        READ_COLUMNS.includes(column) ? row[column as ZomatoColumn] : 'ignored',
      ),
    ),
  ]);
}
