import { zomatoRow } from '../../test/support/zomato-rows';
import { buildTextFixes, serialiseTextFixes } from './build-text-fixes';
import type { ReferenceText } from './dump-text';
import { parseTextFixes } from './text-fixes';

const correct: ReferenceText = {
  name: 'Café Daniel Briand',
  address: 'SCLN 104, Asa Norte, Brasília',
  city: 'Brasília',
  locality: 'Asa Norte',
};

/** The row as the damaged CSV has it. */
const damagedRow = zomatoRow({
  'Restaurant ID': '6601005',
  'Restaurant Name': 'Cafí© Daniel Briand',
  Address: 'SCLN 104, Asa Norte, Brasí_lia',
  City: 'Brasí_lia',
  Locality: 'Asa Norte',
});

const reference = (entries: Record<string, ReferenceText>) =>
  new Map(Object.entries(entries));

describe('buildTextFixes', () => {
  it('lists only the fields whose text differs', () => {
    const { fixes } = buildTextFixes(
      [damagedRow],
      reference({ '6601005': correct }),
    );

    expect(fixes).toEqual({
      '6601005': {
        name: 'Café Daniel Briand',
        address: 'SCLN 104, Asa Norte, Brasília',
        city: 'Brasília',
      },
    });
  });

  it('counts rows and fields in the summary', () => {
    const { summary } = buildTextFixes(
      [damagedRow, zomatoRow()],
      reference({
        '6601005': correct,
        '308022': {
          name: 'Farzi Cafe',
          address: '7-8, Ground Floor, Cyber Hub, DLF Cyber City, Gurgaon',
          city: 'Gurgaon',
          locality: 'Cyber Hub, DLF Cyber City',
        },
      }),
    );

    expect(summary.rows).toBe(2);
    expect(summary.withReference).toBe(2);
    expect(summary.fixedRows).toBe(1);
    expect(summary.fixedFields).toEqual({
      name: 1,
      address: 1,
      city: 1,
      locality: 0,
    });
    expect(summary.unrepairable).toEqual([]);
  });

  it('writes the fix with whitespace collapsed, as the importer will store it', () => {
    const { fixes } = buildTextFixes(
      [zomatoRow({ 'Restaurant Name': 'Cafe' })],
      reference({
        '308022': {
          name: '  Café   Roma ',
          address: '7-8, Ground Floor, Cyber Hub, DLF Cyber City, Gurgaon',
          city: 'Gurgaon',
          locality: 'Cyber Hub, DLF Cyber City',
        },
      }),
    );

    expect(fixes['308022']).toEqual({ name: 'Café Roma' });
  });

  it('does not make a fix out of a difference in whitespace alone', () => {
    const { fixes } = buildTextFixes(
      [zomatoRow({ 'Restaurant Name': 'Farzi   Cafe ' })],
      reference({
        '308022': {
          name: 'Farzi Cafe',
          address: '7-8, Ground Floor, Cyber Hub, DLF Cyber City, Gurgaon',
          city: 'Gurgaon',
          locality: 'Cyber Hub, DLF Cyber City',
        },
      }),
    );

    expect(fixes).toEqual({});
  });

  it('ignores a plain-ASCII row that has no reference', () => {
    const { fixes, summary } = buildTextFixes([zomatoRow()], reference({}));

    expect(fixes).toEqual({});
    expect(summary.withReference).toBe(0);
    expect(summary.unrepairable).toEqual([]);
  });

  it('flags a damaged row that has no reference text to repair it from', () => {
    const { fixes, summary } = buildTextFixes([damagedRow], reference({}));

    expect(fixes).toEqual({});
    expect(summary.unrepairable).toEqual(['6601005']);
  });

  it('counts reference restaurants the CSV does not have, and ignores them', () => {
    const { fixes, summary } = buildTextFixes(
      [zomatoRow()],
      reference({ '1': correct, '2': correct }),
    );

    expect(summary.referenceOnly).toBe(2);
    expect(fixes).toEqual({});
  });
});

describe('serialiseTextFixes', () => {
  it('orders the ids numerically, not as text', () => {
    const text = serialiseTextFixes({
      '10': { name: 'ten' },
      '9': { name: 'nine' },
      '200': { name: 'two hundred' },
    });

    expect(Object.keys(JSON.parse(text))).toEqual(['9', '10', '200']);
  });

  it('keeps that order for ids that JavaScript does not treat as array indexes', () => {
    // JavaScript lists keys such as "9" and "10" in numeric order by itself, so the
    // test above cannot show the sort at work. Keys with leading zeros, or above
    // 4294967294, are ordinary strings listed in the order they were added: here
    // only the sort puts them in numeric order.
    const text = serialiseTextFixes({
      '0010': { name: 'ten' },
      '007': { name: 'seven' },
      '10000000000': { name: 'ten billion' },
      '9999999999': { name: 'nearly ten billion' },
    });

    expect(Object.keys(JSON.parse(text))).toEqual([
      '007',
      '0010',
      '9999999999',
      '10000000000',
    ]);
  });

  it('indents with two spaces, ends with a newline and keeps accents readable', () => {
    expect(serialiseTextFixes({ '1': { name: 'Café' } })).toBe(
      '{\n  "1": {\n    "name": "Café"\n  }\n}\n',
    );
  });

  it('writes an empty object for no fixes', () => {
    expect(serialiseTextFixes({})).toBe('{}\n');
  });

  it('produces text that the importer accepts', () => {
    const { fixes } = buildTextFixes(
      [damagedRow],
      reference({ '6601005': correct }),
    );

    const loaded = parseTextFixes(JSON.parse(serialiseTextFixes(fixes)));

    expect(loaded.get('6601005')?.city).toBe('Brasília');
  });
});
