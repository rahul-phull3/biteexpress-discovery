import { ProblemException } from '../http/problem';
import { parseRestaurantId, RestaurantIdPipe } from './restaurant-id';

describe('parseRestaurantId', () => {
  it('accepts 24 hexadecimal characters', () => {
    expect(parseRestaurantId('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
  });

  it('returns the id in lower case, the form it is stored and returned in', () => {
    expect(parseRestaurantId('507F1F77BCF86CD799439011')).toBe('507f1f77bcf86cd799439011');
  });

  it.each([
    ['empty', ''],
    ['too short', '507f1f77bcf86cd79943901'],
    ['too long', '507f1f77bcf86cd7994390110'],
    ['not hexadecimal', '507f1f77bcf86cd79943901g'],
    ['12 characters, which new ObjectId() would silently accept', 'restaurantXY'],
    ['padded with spaces', ' 507f1f77bcf86cd799439011 '],
    ['a query operator', '{"$ne":"x"}'],
    ['a line break at the end', '507f1f77bcf86cd799439011\n'],
  ])('refuses an id that is %s with a 400 that names the parameter', (_label, id) => {
    let caught: unknown;
    try {
      parseRestaurantId(id);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProblemException);
    expect((caught as ProblemException).problem).toMatchObject({
      status: 400,
      errors: [{ parameter: 'id', detail: 'must be a 24-character hexadecimal restaurant id' }],
    });
  });
});

describe('RestaurantIdPipe', () => {
  it('applies the same rule', () => {
    const pipe = new RestaurantIdPipe();

    expect(pipe.transform('ABCDEFABCDEFABCDEFABCDEF')).toBe('abcdefabcdefabcdefabcdef');
    expect(() => pipe.transform('nope')).toThrow('The restaurant id is not valid.');
  });
});
