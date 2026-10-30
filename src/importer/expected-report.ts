import type { ImportStats } from './import-report';

/** What a correct import of a file should report. */
export interface ExpectedNumbers extends ImportStats {
  /** Imported documents in the collection afterwards. */
  documentsInCollection: number;
}

/** Rows in the full zomato.csv from the take-home archive. */
export const FULL_DATASET_ROWS = 9551;

/**
 * The numbers a correct import of the full zomato.csv produces, measured on
 * the file itself. The report compares a run with them, so a changed rule or a
 * damaged file shows up as a failed check instead of silently different data.
 */
export const FULL_DATASET: ExpectedNumbers = {
  rowsRead: 9551,
  rowsAccepted: 9551,
  rowsRejected: 0,
  textRepaired: 166,
  withLocation: 9051,
  withoutLocation: 500,
  rated: 7403,
  unrated: 2148,
  costUnknown: 18,
  noCuisines: 9,
  distinctCuisines: 145,
  byCountry: {
    IN: 8652,
    US: 434,
    GB: 80,
    AE: 60,
    BR: 60,
    ZA: 60,
    NZ: 40,
    TR: 34,
    AU: 24,
    PH: 22,
    ID: 21,
    LK: 20,
    QA: 20,
    SG: 20,
    CA: 4,
  },
  documentsInCollection: 9551,
};

/**
 * Expected numbers exist only for the full dataset, recognised by its row
 * count. Any other file (the sample, a test file) has none and is not judged.
 */
export function expectedNumbersFor(
  rowsRead: number,
): ExpectedNumbers | undefined {
  return rowsRead === FULL_DATASET_ROWS ? FULL_DATASET : undefined;
}
