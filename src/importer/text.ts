/**
 * Puts text into its tidy form: every run of whitespace (spaces, tabs, line
 * breaks, non-breaking spaces) becomes a single space and the ends are
 * trimmed. The CSV has names with stray spaces and six addresses with a raw
 * line break in the middle.
 */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** True when the text contains any character outside plain ASCII. */
export function hasNonAscii(value: string): boolean {
  return /[\u0080-\uFFFF]/.test(value);
}
