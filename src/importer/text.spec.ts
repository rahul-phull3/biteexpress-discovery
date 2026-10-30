import { collapseWhitespace, hasNonAscii } from './text';

describe('collapseWhitespace', () => {
  it('turns a run of spaces into one space and trims the ends', () => {
    expect(collapseWhitespace('  Hello   World  ')).toBe('Hello World');
  });

  it('turns tabs and line breaks into a single space', () => {
    expect(collapseWhitespace('Line one,\r\nLine two\tend')).toBe(
      'Line one, Line two end',
    );
    expect(collapseWhitespace('a\rb\nc')).toBe('a b c');
  });

  it('treats a non-breaking space as whitespace', () => {
    expect(collapseWhitespace('a\u00a0\u00a0b')).toBe('a b');
  });

  it('leaves clean text alone and keeps accents', () => {
    expect(collapseWhitespace('Café Daniel Briand')).toBe('Café Daniel Briand');
  });

  it('turns whitespace-only text into an empty string', () => {
    expect(collapseWhitespace(' \t\r\n ')).toBe('');
    expect(collapseWhitespace('')).toBe('');
  });
});

describe('hasNonAscii', () => {
  it('is false for plain ASCII, punctuation and control characters', () => {
    expect(hasNonAscii('Farzi Cafe, 7-8 (Ground Floor)')).toBe(false);
    expect(hasNonAscii('tab\there')).toBe(false);
    expect(hasNonAscii('')).toBe(false);
  });

  it('is true for accents, other scripts and the damage the CSV contains', () => {
    expect(hasNonAscii('Café')).toBe(true);
    expect(hasNonAscii('Brasí_lia')).toBe(true);
    expect(hasNonAscii('四川担担面')).toBe(true);
    expect(hasNonAscii('\u0080')).toBe(true);
  });
});
