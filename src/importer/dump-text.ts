import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { describeError } from '../database/mongo-errors';
import { collapseWhitespace } from './text';
import { TEXT_FIELDS, type TextField } from './text-fixes';

/**
 * The part of a Zomato API dump page that this project reads: the id and four
 * text fields of each restaurant, and nothing else. Zod drops every other key
 * while parsing, so the Zomato apikey that sits on every record is never kept,
 * never copied into text-fixes.json and never printed. Some pages have no
 * "restaurants" list at all (731 of them), which is fine.
 */
const dumpSchema = z.array(
  z.object({
    restaurants: z
      .array(
        z.object({
          restaurant: z.object({
            R: z.object({ res_id: z.number().int() }),
            name: z.string(),
            location: z.object({
              address: z.string(),
              city: z.string(),
              locality: z.string(),
            }),
          }),
        }),
      )
      .optional(),
  }),
);

export type ReferenceText = Record<TextField, string>;

/** The correct text per restaurant id, gathered from one or more dump files. */
export interface ReferenceTexts {
  byId: Map<string, ReferenceText>;
  /** Records read, counting the repeats (the dumps list most restaurants several times). */
  records: number;
  /** Ids that appear twice with different text. Should be empty. */
  conflictingIds: Set<string>;
}

export function createReferenceTexts(): ReferenceTexts {
  return { byId: new Map(), records: 0, conflictingIds: new Set() };
}

/** Adds the restaurants of one parsed dump file (an array of pages). */
export function collectReferenceTexts(
  pages: unknown,
  into: ReferenceTexts,
  label = 'The dump',
): void {
  const result = dumpSchema.safeParse(pages);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map(
        (issue) =>
          `  ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(
      `${label} does not look like a Zomato API dump:\n${issues}`,
      {
        cause: result.error,
      },
    );
  }

  for (const page of result.data) {
    for (const { restaurant } of page.restaurants ?? []) {
      into.records += 1;
      const id = String(restaurant.R.res_id);
      const text: ReferenceText = {
        name: restaurant.name,
        address: restaurant.location.address,
        city: restaurant.location.city,
        locality: restaurant.location.locality,
      };
      const known = into.byId.get(id);
      if (!known) {
        into.byId.set(id, text);
      } else if (
        TEXT_FIELDS.some(
          (field) =>
            collapseWhitespace(known[field]) !==
            collapseWhitespace(text[field]),
        )
      ) {
        into.conflictingIds.add(id);
      }
    }
  }
}

/** Reads dump files and gathers the text of every restaurant in them. */
export async function readReferenceTexts(
  paths: readonly string[],
): Promise<ReferenceTexts> {
  const gathered = createReferenceTexts();
  for (const path of paths) {
    let pages: unknown;
    try {
      pages = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      throw new Error(
        `Could not read the dump "${path}": ${describeError(error)}`,
        {
          cause: error,
        },
      );
    }
    collectReferenceTexts(pages, gathered, `"${path}"`);
  }
  return gathered;
}
