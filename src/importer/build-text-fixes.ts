import type { ReferenceText } from './dump-text';
import { collapseWhitespace, hasNonAscii } from './text';
import {
  TEXT_FIELD_COLUMNS,
  TEXT_FIELDS,
  type TextField,
  type TextFix,
} from './text-fixes';
import type { ZomatoRow } from './zomato-csv';

export interface TextFixesBuild {
  fixes: Record<string, TextFix>;
  summary: {
    rows: number;
    /** CSV rows whose id was found in the dumps. */
    withReference: number;
    /** Ids in the dumps that the CSV does not have (test records and others). Ignored. */
    referenceOnly: number;
    /** Rows that got a fix. */
    fixedRows: number;
    fixedFields: Record<TextField, number>;
    /** Rows with non-ASCII text and no reference text: damaged, and nothing to repair them from. */
    unrepairable: string[];
  };
}

/**
 * For each CSV row, compares name, address, city and locality (whitespace
 * collapsed) with the Zomato API text for the same id. A field that differs
 * becomes a fix. Differences in whitespace alone are not fixes: the importer
 * collapses whitespace anyway.
 */
export function buildTextFixes(
  rows: readonly ZomatoRow[],
  reference: ReadonlyMap<string, ReferenceText>,
): TextFixesBuild {
  const fixes: Record<string, TextFix> = {};
  const fixedFields: Record<TextField, number> = {
    name: 0,
    address: 0,
    city: 0,
    locality: 0,
  };
  const unrepairable: string[] = [];
  const csvIds = new Set<string>();
  let withReference = 0;

  for (const row of rows) {
    const id = row['Restaurant ID'].trim();
    csvIds.add(id);
    const correct = reference.get(id);
    if (!correct) {
      if (TEXT_FIELDS.some((f) => hasNonAscii(row[TEXT_FIELD_COLUMNS[f]]))) {
        unrepairable.push(id);
      }
      continue;
    }
    withReference += 1;

    const fix: TextFix = {};
    for (const field of TEXT_FIELDS) {
      const wanted = collapseWhitespace(correct[field]);
      if (collapseWhitespace(row[TEXT_FIELD_COLUMNS[field]]) !== wanted) {
        fix[field] = wanted;
        fixedFields[field] += 1;
      }
    }
    if (Object.keys(fix).length > 0) fixes[id] = fix;
  }

  let referenceOnly = 0;
  for (const id of reference.keys()) {
    if (!csvIds.has(id)) referenceOnly += 1;
  }

  return {
    fixes,
    summary: {
      rows: rows.length,
      withReference,
      referenceOnly,
      fixedRows: Object.keys(fixes).length,
      fixedFields,
      unrepairable,
    },
  };
}

/** The exact text of data/text-fixes.json: ids in numeric order, two-space indent, final newline. */
export function serialiseTextFixes(fixes: Record<string, TextFix>): string {
  const sorted: Record<string, TextFix> = {};
  for (const id of Object.keys(fixes).sort((a, b) => Number(a) - Number(b))) {
    sorted[id] = fixes[id];
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
