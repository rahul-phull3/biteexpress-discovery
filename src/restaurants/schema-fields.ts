import { z } from 'zod';
import { collapseWhitespace } from '../importer/text';

/** Text with its whitespace collapsed (as the importer does), then 1 to `max` characters. */
export const text = (max: number) =>
  z
    .string()
    .transform(collapseWhitespace)
    .pipe(
      z
        .string()
        .min(1, 'must not be empty')
        .max(max, `must be at most ${max} characters`),
    );
