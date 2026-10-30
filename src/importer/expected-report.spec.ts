import {
  expectedNumbersFor,
  FULL_DATASET,
  FULL_DATASET_ROWS,
} from './expected-report';

const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);

describe('FULL_DATASET', () => {
  it('describes the 9,551 rows of the take-home file', () => {
    expect(FULL_DATASET_ROWS).toBe(9551);
    expect(FULL_DATASET.rowsRead).toBe(FULL_DATASET_ROWS);
  });

  it('accepts every row and rejects none', () => {
    expect(FULL_DATASET.rowsAccepted).toBe(9551);
    expect(FULL_DATASET.rowsRejected).toBe(0);
    expect(FULL_DATASET.documentsInCollection).toBe(9551);
  });

  it('is consistent with itself', () => {
    expect(FULL_DATASET.withLocation + FULL_DATASET.withoutLocation).toBe(9551);
    expect(FULL_DATASET.rated + FULL_DATASET.unrated).toBe(9551);
    expect(sum(Object.values(FULL_DATASET.byCountry))).toBe(9551);
    expect(Object.keys(FULL_DATASET.byCountry)).toHaveLength(15);
  });

  it('lists countries from the largest to the smallest, as the report does', () => {
    const counts = Object.values(FULL_DATASET.byCountry);

    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe('expectedNumbersFor', () => {
  it('has numbers for the full file only, recognised by its row count', () => {
    expect(expectedNumbersFor(9551)).toBe(FULL_DATASET);
    expect(expectedNumbersFor(500)).toBeUndefined();
    expect(expectedNumbersFor(0)).toBeUndefined();
    expect(expectedNumbersFor(9552)).toBeUndefined();
  });
});
