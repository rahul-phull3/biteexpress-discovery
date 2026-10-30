import type { ExpectedNumbers } from './expected-report';
import type { ImportedRestaurant } from './imported-restaurant';
import type { CollectionSummary, WriteTotals } from './restaurant-sink';

/** Counts over one run, taken from what the cleaning produced. */
export interface ImportStats {
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  /** Rows whose text was replaced from text-fixes.json. */
  textRepaired: number;
  withLocation: number;
  withoutLocation: number;
  rated: number;
  unrated: number;
  /** Rows whose average cost for two is unknown (0 in the CSV). */
  costUnknown: number;
  noCuisines: number;
  distinctCuisines: number;
  /** Accepted rows per ISO country code, largest first. */
  byCountry: Record<string, number>;
}

export interface RejectedRow {
  sourceId: string;
  reason: string;
}

export function computeStats(
  rowsRead: number,
  accepted: readonly ImportedRestaurant[],
  rowsRejected: number,
): ImportStats {
  const cuisines = new Set<string>();
  const perCountry = new Map<string, number>();
  let textRepaired = 0;
  let withLocation = 0;
  let rated = 0;
  let costUnknown = 0;
  let noCuisines = 0;

  for (const restaurant of accepted) {
    if (restaurant.dataQuality.includes('text_repaired')) textRepaired += 1;
    if (restaurant.location) withLocation += 1;
    if (restaurant.rating.average !== null) rated += 1;
    if (restaurant.cost.forTwo === null) costUnknown += 1;
    if (restaurant.cuisines.length === 0) noCuisines += 1;
    for (const cuisine of restaurant.cuisines) cuisines.add(cuisine);
    const code = restaurant.address.country.code;
    perCountry.set(code, (perCountry.get(code) ?? 0) + 1);
  }

  return {
    rowsRead,
    rowsAccepted: accepted.length,
    rowsRejected,
    textRepaired,
    withLocation,
    withoutLocation: accepted.length - withLocation,
    rated,
    unrated: accepted.length - rated,
    costUnknown,
    noCuisines,
    distinctCuisines: cuisines.size,
    byCountry: Object.fromEntries(
      [...perCountry].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)),
    ),
  };
}

/** One line of the comparison with the expected numbers. */
export interface Check {
  label: string;
  expected: string;
  actual: string;
  ok: boolean;
}

/**
 * Compares a run with the expected numbers. The collection checks are made
 * only when the run wrote to a database (a dry run has none).
 */
export function compareWithExpected(
  stats: ImportStats,
  expected: ExpectedNumbers,
  collection?: CollectionSummary,
): Check[] {
  const checks: Check[] = [];
  const number = (label: string, want: number, got: number) => {
    checks.push({
      label,
      expected: format(want),
      actual: format(got),
      ok: want === got,
    });
  };

  number('rows read', expected.rowsRead, stats.rowsRead);
  number('rows imported', expected.rowsAccepted, stats.rowsAccepted);
  number('rows rejected', expected.rowsRejected, stats.rowsRejected);
  number('texts repaired', expected.textRepaired, stats.textRepaired);
  number('with a location', expected.withLocation, stats.withLocation);
  number('without a location', expected.withoutLocation, stats.withoutLocation);
  number('rated', expected.rated, stats.rated);
  number('not rated', expected.unrated, stats.unrated);
  number('cost unknown', expected.costUnknown, stats.costUnknown);
  number('no cuisines', expected.noCuisines, stats.noCuisines);
  number(
    'distinct cuisines',
    expected.distinctCuisines,
    stats.distinctCuisines,
  );

  const codes = new Set([
    ...Object.keys(expected.byCountry),
    ...Object.keys(stats.byCountry),
  ]);
  const differing = [...codes]
    .filter(
      (code) =>
        (expected.byCountry[code] ?? 0) !== (stats.byCountry[code] ?? 0),
    )
    .sort();
  checks.push({
    label: 'rows per country',
    expected:
      differing.length === 0
        ? `${Object.keys(expected.byCountry).length} countries`
        : differing
            .map((c) => `${c} ${format(expected.byCountry[c] ?? 0)}`)
            .join(', '),
    actual:
      differing.length === 0
        ? 'all counts match'
        : differing
            .map((c) => `${c} ${format(stats.byCountry[c] ?? 0)}`)
            .join(', '),
    ok: differing.length === 0,
  });

  if (collection) {
    number(
      'documents in the collection',
      expected.documentsInCollection,
      collection.documents,
    );
    number(
      'documents with a location',
      expected.withLocation,
      collection.withLocation,
    );
  }
  return checks;
}

export interface ImportReport {
  file: string;
  tenantId: string;
  /** Where the run wrote, or undefined for a dry run. */
  target?: { database: string; collection: string };
  fixesLoaded: number;
  stats: ImportStats;
  rejected: RejectedRow[];
  writes?: WriteTotals;
  collection?: CollectionSummary;
  /** Undefined when there are no expected numbers for this file. */
  checks?: Check[];
}

export function reportPassed(report: ImportReport): boolean {
  return (
    report.rejected.length === 0 &&
    (report.writes?.failures.length ?? 0) === 0 &&
    (report.checks ?? []).every((check) => check.ok)
  );
}

const SHOWN = 10;

/** The report as plain ASCII text, so it reads the same in any terminal. */
export function formatReport(report: ImportReport): string {
  const { stats } = report;
  const lines: string[] = ['Import report', '-------------'];
  const row = (label: string, value: string) =>
    lines.push(`${`${label} `.padEnd(28, '.')} ${value}`);

  row('File', report.file);
  row(
    'Target',
    report.target
      ? `${report.target.database}.${report.target.collection}, tenant "${report.tenantId}"`
      : `dry run, nothing written (tenant "${report.tenantId}")`,
  );
  row('Rows read', format(stats.rowsRead));
  row('Rows imported', format(stats.rowsAccepted));
  row('Rows rejected', format(stats.rowsRejected));
  row(
    'Texts repaired',
    `${format(stats.textRepaired)} (${format(report.fixesLoaded)} fixes loaded)`,
  );
  row('With a location', format(stats.withLocation));
  row('Without a location', format(stats.withoutLocation));
  row('Rated', format(stats.rated));
  row('Not rated', format(stats.unrated));
  row('Cost unknown', format(stats.costUnknown));
  row('No cuisines', format(stats.noCuisines));
  row('Distinct cuisines', format(stats.distinctCuisines));
  row(
    'By country',
    Object.entries(stats.byCountry)
      .map(([code, n]) => `${code} ${format(n)}`)
      .join(', '),
  );
  if (report.writes) {
    row(
      'Written',
      `inserted ${format(report.writes.inserted)}, matched ${format(report.writes.matched)}, ` +
        `modified ${format(report.writes.modified)}, failed ${format(report.writes.failures.length)}`,
    );
  }
  if (report.collection) {
    row(
      'In the collection',
      `${format(report.collection.documents)} documents, ${format(report.collection.withLocation)} with a location`,
    );
  }

  if (report.rejected.length > 0) {
    lines.push('', `Rejected rows (${report.rejected.length}):`);
    for (const rejected of report.rejected.slice(0, SHOWN)) {
      lines.push(`  id ${rejected.sourceId}: ${rejected.reason}`);
    }
    if (report.rejected.length > SHOWN) {
      lines.push(`  ... and ${report.rejected.length - SHOWN} more`);
    }
  }
  if (report.writes && report.writes.failures.length > 0) {
    lines.push(
      '',
      `Rows the database refused (${report.writes.failures.length}):`,
    );
    for (const failure of report.writes.failures.slice(0, SHOWN)) {
      lines.push(`  id ${failure.sourceId}: ${failure.message}`);
    }
    if (report.writes.failures.length > SHOWN) {
      lines.push(`  ... and ${report.writes.failures.length - SHOWN} more`);
    }
  }

  lines.push('');
  if (report.checks) {
    lines.push('Checks against the full dataset');
    for (const check of report.checks) {
      lines.push(
        check.ok
          ? `  [ok]   ${check.label}: ${check.actual}`
          : `  [FAIL] ${check.label}: expected ${check.expected}, got ${check.actual}`,
      );
    }
  } else {
    lines.push(
      'No expected numbers for this file: they exist for the full 9,551-row dataset only.',
    );
  }
  lines.push('', reportPassed(report) ? 'Result: PASS' : 'Result: FAIL');
  return lines.join('\n');
}

function format(value: number): string {
  return value.toLocaleString('en-US');
}
