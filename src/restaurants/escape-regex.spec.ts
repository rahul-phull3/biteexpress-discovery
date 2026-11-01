import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeRegex('Naivedhyam 29 & Co')).toBe('Naivedhyam 29 & Co');
  });

  it.each(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])(
    'escapes %s, so it matches only itself',
    (character) => {
      const pattern = new RegExp(escapeRegex(character));

      expect(pattern.test(character)).toBe(true);
      expect(pattern.test('x')).toBe(false);
    },
  );

  it('matches a whole name with pattern characters in it, and nothing else', () => {
    const name = 'Cafe (Bar) [Main] +1 $5.00?';
    const pattern = new RegExp(escapeRegex(name), 'i');

    expect(pattern.test(`The ${name} Club`)).toBe(true);
    expect(pattern.test('Cafe Bar Main 1 5900')).toBe(false);
  });
});
