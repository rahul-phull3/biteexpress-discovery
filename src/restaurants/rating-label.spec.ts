import { ratingLabel } from './rating-label';

describe('ratingLabel', () => {
  it.each([
    [1.8, 'Poor'],
    [2.4, 'Poor'],
    [2.5, 'Average'],
    [3.4, 'Average'],
    [3.5, 'Good'],
    [3.9, 'Good'],
    [4.0, 'Very Good'],
    [4.4, 'Very Good'],
    [4.5, 'Excellent'],
    [4.9, 'Excellent'],
    [5, 'Excellent'],
  ])('labels an average of %s as %s', (average, label) => {
    expect(ratingLabel(average)).toBe(label);
  });

  it('applies the bands to the exact value, so 4.49 is still Very Good', () => {
    expect(ratingLabel(4.49)).toBe('Very Good');
    expect(ratingLabel(3.499)).toBe('Average');
  });
});
