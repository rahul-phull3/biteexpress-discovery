/**
 * "Best" must not mean the highest raw average, or 3.7 from 25 votes would beat
 * 3.6 from 500. The score pulls every average toward a prior mean, and the
 * fewer votes a restaurant has, the harder it is pulled:
 *
 *   score = v / (v + m) * R + m / (v + m) * C
 *
 * R is the restaurant's average, v its votes, C the prior mean and m the
 * prior weight.
 */

/** C: the mean rating of the 7,403 rated restaurants in the full dataset. A constant, so a sample file scores the same as the full one. */
export const PRIOR_MEAN_RATING = 3.44;

/** m: the number of votes at which a restaurant's own average counts as much as the prior. */
export const PRIOR_WEIGHT_VOTES = 50;

/** The weighted score of a rated restaurant, rounded to 4 decimals. */
export function weightedRatingScore(average: number, votes: number): number {
  const score =
    (votes / (votes + PRIOR_WEIGHT_VOTES)) * average +
    (PRIOR_WEIGHT_VOTES / (votes + PRIOR_WEIGHT_VOTES)) * PRIOR_MEAN_RATING;
  return Math.round(score * 10_000) / 10_000;
}
