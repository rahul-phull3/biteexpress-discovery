/**
 * The words that go with an average rating. The bands are Zomato's own. They
 * were checked against all 7,403 rated restaurants of the dataset: the label
 * is a pure function of the average, and no two labels overlap
 * (Poor 1.8-2.4, Average 2.5-3.4, Good 3.5-3.9, Very Good 4.0-4.4,
 * Excellent 4.5-4.9). The importer keeps the CSV's own text; a restaurant
 * created through the API gets the same words from here, so labels agree.
 */
export function ratingLabel(average: number): string {
  if (average >= 4.5) return 'Excellent';
  if (average >= 4.0) return 'Very Good';
  if (average >= 3.5) return 'Good';
  if (average >= 2.5) return 'Average';
  return 'Poor';
}
