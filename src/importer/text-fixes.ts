import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { describeError } from '../database/mongo-errors';
import type { ZomatoColumn } from './zomato-csv';

/** The four text fields that can be damaged in the CSV. */
export const TEXT_FIELDS = ['name', 'address', 'city', 'locality'] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/** Which CSV column holds each text field. */
export const TEXT_FIELD_COLUMNS = {
  name: 'Restaurant Name',
  address: 'Address',
  city: 'City',
  locality: 'Locality',
} as const satisfies Record<TextField, ZomatoColumn>;

/**
 * data/text-fixes.json: for the restaurants whose CSV text is damaged (the
 * letters "é" and "í" come out as "í©" and "í_"), the correct text from the
 * Zomato API dumps. The key is the Zomato restaurant id, and a fix lists only
 * the fields that are wrong. The dumps themselves never enter the repository.
 */
const textFixSchema = z
  .strictObject({
    name: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    locality: z.string().optional(),
  })
  .refine(
    (fix) => Object.keys(fix).length > 0,
    'a fix needs at least one of: name, address, city, locality',
  );

export const textFixesSchema = z.record(
  z.string().regex(/^\d+$/, 'keys must be Zomato restaurant ids (digits only)'),
  textFixSchema,
);

export type TextFix = z.infer<typeof textFixSchema>;

/** Fixes by Zomato restaurant id. */
export type TextFixes = ReadonlyMap<string, TextFix>;

/** Validates the content of a text-fixes file and returns it as a Map. */
export function parseTextFixes(
  json: unknown,
  label = 'The text fixes',
): TextFixes {
  const result = textFixesSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `${label} is not valid:\n${z.prettifyError(result.error)}`,
      {
        cause: result.error,
      },
    );
  }
  return new Map(Object.entries(result.data));
}

export async function loadTextFixes(path: string): Promise<TextFixes> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not read the text fixes file "${path}": ${describeError(error)}. ` +
        'It is committed as data/text-fixes.json; npm run import:fixes rebuilds it.',
      { cause: error },
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`"${path}" is not valid JSON: ${describeError(error)}`, {
      cause: error,
    });
  }
  return parseTextFixes(json, `"${path}"`);
}
