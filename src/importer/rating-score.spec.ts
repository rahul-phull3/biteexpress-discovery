import {
  PRIOR_MEAN_RATING,
  PRIOR_WEIGHT_VOTES,
  weightedRatingScore,
} from './rating-score';

describe('weightedRatingScore', () => {
  it('uses a prior mean of 3.44 and a prior weight of 50 votes', () => {
    expect(PRIOR_MEAN_RATING).toBe(3.44);
    expect(PRIOR_WEIGHT_VOTES).toBe(50);
  });

  it('pulls a well-reviewed restaurant slightly toward the prior', () => {
    // Farzi Cafe: 4.3 from 4,385 votes.
    expect(weightedRatingScore(4.3, 4385)).toBe(4.2903);
  });

  it('pulls a restaurant with few votes strongly toward the prior', () => {
    // 3.8 from only 9 votes is barely better than the prior mean.
    expect(weightedRatingScore(3.8, 9)).toBe(3.4949);
  });

  it('gives a restaurant with no votes exactly the prior mean', () => {
    expect(weightedRatingScore(5, 0)).toBe(3.44);
  });

  it('counts the restaurant and the prior equally at 50 votes', () => {
    expect(weightedRatingScore(5, 50)).toBe(4.22);
  });

  it('ranks 3.6 from 500 votes above 3.7 from 25 votes', () => {
    expect(weightedRatingScore(3.6, 500)).toBeGreaterThan(
      weightedRatingScore(3.7, 25),
    );
  });

  it('approaches the restaurant average as the votes grow', () => {
    expect(weightedRatingScore(4, 1_000_000)).toBeGreaterThan(3.9999);
  });

  it('never exceeds 5, the largest rating', () => {
    expect(weightedRatingScore(5, 1_000_000)).toBeLessThanOrEqual(5);
  });

  it('rounds to 4 decimals', () => {
    for (const [average, votes] of [
      [4.3, 4385],
      [3.1, 7],
      [4.9, 123],
      [2.2, 3],
    ] as const) {
      const score = weightedRatingScore(average, votes);
      expect(Number(score.toFixed(4))).toBe(score);
    }
  });
});
