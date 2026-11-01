/**
 * Makes text safe to put inside a regular expression: every character that
 * means something to a regex is escaped, so a person's input is only ever
 * matched literally. "a.b(c)*" matches those characters and nothing else.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
