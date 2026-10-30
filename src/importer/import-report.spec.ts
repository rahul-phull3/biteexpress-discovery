import { zomatoRow } from '../../test/support/zomato-rows';
import { cleanRow } from './clean-row';
import { FULL_DATASET } from './expected-report';
import {
  compareWithExpected,
  computeStats,
  formatReport,
  reportPassed,
  type ImportReport,
  type ImportStats,
} from './import-report';
import type { ImportedRestaurant } from './imported-restaurant';
import type { ZomatoRow } from './zomato-csv';

function restaurant(overrides: Partial<ZomatoRow> = {}): ImportedRestaurant {
  const result = cleanRow(zomatoRow(overrides), new Map());
  if (!result.ok) throw new Error(result.reason);
  return result.restaurant;
}

const stats: ImportStats = {
  rowsRead: 3,
  rowsAccepted: 3,
  rowsRejected: 0,
  textRepaired: 0,
  withLocation: 2,
  withoutLocation: 1,
  rated: 2,
  unrated: 1,
  costUnknown: 1,
  noCuisines: 1,
  distinctCuisines: 2,
  byCountry: { IN: 2, US: 1 },
};

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    file: 'data/sample/zomato-sample.csv',
    tenantId: 'biteexpress',
    fixesLoaded: 166,
    stats,
    rejected: [],
    ...overrides,
  };
}

describe('computeStats', () => {
  const documents = [
    restaurant({ Cuisines: 'Modern Indian, Cafe' }),
    restaurant({
      'Restaurant ID': '2',
      Latitude: '0',
      Longitude: '0',
      Cuisines: '',
      'Average Cost for two': '0',
      'Aggregate rating': '0',
    }),
    restaurant({
      'Restaurant ID': '3',
      'Country Code': '216',
      Longitude: '-122.4',
      Latitude: '37.8',
      Cuisines: 'Cafe',
    }),
  ];

  it('counts what the cleaning produced', () => {
    expect(computeStats(3, documents, 0)).toEqual(stats);
  });

  it('counts the rows read and rejected as given', () => {
    const result = computeStats(10, documents, 7);

    expect(result.rowsRead).toBe(10);
    expect(result.rowsRejected).toBe(7);
    expect(result.rowsAccepted).toBe(3);
  });

  it('counts repaired texts', () => {
    const repaired = {
      ...documents[0],
      dataQuality: ['text_repaired' as const],
    };

    expect(computeStats(1, [repaired], 0).textRepaired).toBe(1);
  });

  it('lists countries from the largest to the smallest, ties by code', () => {
    const result = computeStats(
      4,
      [
        restaurant({ 'Country Code': '216' }),
        restaurant({ 'Country Code': '215' }),
        restaurant({ 'Country Code': '1' }),
        restaurant({ 'Country Code': '1' }),
      ],
      0,
    );

    expect(Object.entries(result.byCountry)).toEqual([
      ['IN', 2],
      ['GB', 1],
      ['US', 1],
    ]);
  });

  it('handles an empty run', () => {
    expect(computeStats(0, [], 0)).toEqual({
      rowsRead: 0,
      rowsAccepted: 0,
      rowsRejected: 0,
      textRepaired: 0,
      withLocation: 0,
      withoutLocation: 0,
      rated: 0,
      unrated: 0,
      costUnknown: 0,
      noCuisines: 0,
      distinctCuisines: 0,
      byCountry: {},
    });
  });
});

describe('compareWithExpected', () => {
  const full = { ...FULL_DATASET };
  const matching: ImportStats = { ...FULL_DATASET };

  it('passes every check when the numbers match', () => {
    const checks = compareWithExpected(matching, full);

    expect(checks.every((check) => check.ok)).toBe(true);
    expect(checks.map((check) => check.label)).toEqual([
      'rows read',
      'rows imported',
      'rows rejected',
      'texts repaired',
      'with a location',
      'without a location',
      'rated',
      'not rated',
      'cost unknown',
      'no cuisines',
      'distinct cuisines',
      'rows per country',
    ]);
  });

  it('flags the number that differs, with both values', () => {
    const checks = compareWithExpected(
      { ...matching, withLocation: 9000 },
      full,
    );

    const failed = checks.filter((check) => !check.ok);
    expect(failed).toEqual([
      {
        label: 'with a location',
        expected: '9,051',
        actual: '9,000',
        ok: false,
      },
    ]);
  });

  it('names only the countries whose counts differ, including one that is missing', () => {
    const byCountry = { ...FULL_DATASET.byCountry, IN: 8000 } as Record<
      string,
      number
    >;
    delete byCountry.CA;

    const checks = compareWithExpected({ ...matching, byCountry }, full);

    const country = checks.find((check) => check.label === 'rows per country');
    expect(country?.ok).toBe(false);
    expect(country?.expected).toBe('CA 4, IN 8,652');
    expect(country?.actual).toBe('CA 0, IN 8,000');
  });

  it('adds the collection checks only when there is a collection to look at', () => {
    const without = compareWithExpected(matching, full);
    const withCollection = compareWithExpected(matching, full, {
      documents: 9551,
      withLocation: 9051,
    });

    expect(without).toHaveLength(12);
    expect(withCollection).toHaveLength(14);
    expect(withCollection.slice(12).map((check) => check.label)).toEqual([
      'documents in the collection',
      'documents with a location',
    ]);
    expect(withCollection.every((check) => check.ok)).toBe(true);
  });

  it('fails the collection check when documents were left over or are missing', () => {
    const checks = compareWithExpected(matching, full, {
      documents: 9552,
      withLocation: 9051,
    });

    expect(checks.filter((check) => !check.ok).map((c) => c.label)).toEqual([
      'documents in the collection',
    ]);
  });
});

describe('reportPassed', () => {
  it('passes a clean run without expected numbers', () => {
    expect(reportPassed(report())).toBe(true);
  });

  it('fails when a row was rejected', () => {
    expect(
      reportPassed(report({ rejected: [{ sourceId: '1', reason: 'bad' }] })),
    ).toBe(false);
  });

  it('fails when the database refused a row', () => {
    expect(
      reportPassed(
        report({
          writes: {
            inserted: 2,
            matched: 0,
            modified: 0,
            failures: [
              { sourceId: '3', message: 'Document failed validation' },
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it('fails when a check fails and passes when all checks pass', () => {
    const ok = { label: 'a', expected: '1', actual: '1', ok: true };
    const bad = { label: 'b', expected: '1', actual: '2', ok: false };

    expect(reportPassed(report({ checks: [ok] }))).toBe(true);
    expect(reportPassed(report({ checks: [ok, bad] }))).toBe(false);
  });
});

describe('formatReport', () => {
  it('shows the run, with thousands separators, and passes', () => {
    const text = formatReport(
      report({ stats: { ...FULL_DATASET }, fixesLoaded: 166 }),
    );

    expect(text).toContain('Rows read .................. 9,551');
    expect(text).toContain(
      'Texts repaired ............. 166 (166 fixes loaded)',
    );
    expect(text).toContain(
      'By country ................. IN 8,652, US 434, GB 80',
    );
    expect(text).toContain('Result: PASS');
  });

  it('says a dry run wrote nothing', () => {
    expect(formatReport(report())).toContain(
      'dry run, nothing written (tenant "biteexpress")',
    );
  });

  it('names the database, the collection and the tenant of a real run', () => {
    const text = formatReport(
      report({
        target: { database: 'biteexpress', collection: 'restaurants' },
        writes: { inserted: 3, matched: 0, modified: 0, failures: [] },
        collection: { documents: 3, withLocation: 2 },
      }),
    );

    expect(text).toContain('biteexpress.restaurants, tenant "biteexpress"');
    expect(text).toContain('inserted 3, matched 0, modified 0, failed 0');
    expect(text).toContain('3 documents, 2 with a location');
  });

  it('lists the checks against the full dataset, marking each', () => {
    const text = formatReport(
      report({
        checks: [
          { label: 'rated', expected: '7,403', actual: '7,403', ok: true },
          { label: 'not rated', expected: '2,148', actual: '2,000', ok: false },
        ],
      }),
    );

    expect(text).toContain('[ok]   rated: 7,403');
    expect(text).toContain('[FAIL] not rated: expected 2,148, got 2,000');
    expect(text).toContain('Result: FAIL');
  });

  it('says why there are no checks for a file other than the full dataset', () => {
    expect(formatReport(report())).toContain(
      'No expected numbers for this file: they exist for the full 9,551-row dataset only.',
    );
  });

  it('lists rejected rows, ten at most, then says how many more', () => {
    const rejected = Array.from({ length: 12 }, (_, index) => ({
      sourceId: String(index + 1),
      reason: 'the name is empty',
    }));

    const text = formatReport(report({ rejected }));

    expect(text).toContain('Rejected rows (12):');
    expect(text).toContain('  id 1: the name is empty');
    expect(text).toContain('  id 10: the name is empty');
    expect(text).not.toContain('  id 11: the name is empty');
    expect(text).toContain('  ... and 2 more');
    expect(text).toContain('Result: FAIL');
  });

  it('lists the rows the database refused', () => {
    const text = formatReport(
      report({
        writes: {
          inserted: 2,
          matched: 0,
          modified: 0,
          failures: [
            { sourceId: '3', message: 'Document failed validation (code 121)' },
          ],
        },
      }),
    );

    expect(text).toContain('Rows the database refused (1):');
    expect(text).toContain('  id 3: Document failed validation (code 121)');
    expect(text).toContain('Result: FAIL');
  });

  it('uses plain ASCII only, so every terminal shows it the same way', () => {
    const text = formatReport(
      report({
        target: { database: 'biteexpress', collection: 'restaurants' },
        checks: compareWithExpected({ ...FULL_DATASET }, FULL_DATASET),
        rejected: [{ sourceId: '1', reason: 'the name is empty' }],
      }),
    );

    const outsideAscii = [...text].filter(
      (character) => character !== '\n' && (character < ' ' || character > '~'),
    );
    expect(outsideAscii).toEqual([]);
  });
});
