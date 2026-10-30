import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { describeError } from '../database/mongo-errors';
import { buildTextFixes, serialiseTextFixes } from './build-text-fixes';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  type CliIo,
} from './cli-common';
import { readReferenceTexts } from './dump-text';
import { TEXT_FIELDS } from './text-fixes';
import { readZomatoCsv } from './zomato-csv';

export const DEFAULT_FULL_CSV = 'data/full/zomato.csv';
export const DEFAULT_DUMPS_DIRECTORY = 'data/full';
export const DEFAULT_FIXES_FILE = 'data/text-fixes.json';

export const FIXES_USAGE = `Usage: npm run import:fixes -- [options]

Rebuilds data/text-fixes.json. The CSV has damaged text in some rows (accented
letters replaced by junk characters). The Zomato API dumps that come with the
take-home hold the correct text for the same restaurant ids, so this tool
compares the two and writes down every difference.

You only need this to regenerate the file; a ready-made copy is committed.

Options:
  --csv <path>      The full CSV (default: ${DEFAULT_FULL_CSV})
  --dumps <dir>     Folder with file1.json, file2.json ... (default: ${DEFAULT_DUMPS_DIRECTORY})
  --out <path>      File to write (default: ${DEFAULT_FIXES_FILE})
  --check           Write nothing; exit 1 if the file would change
  -h, --help        Show this help`;

export interface FixesOptions {
  help: boolean;
  csv: string;
  dumps: string;
  out: string;
  check: boolean;
}

export function parseFixesArgs(argv: readonly string[]): FixesOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        csv: { type: 'string' },
        dumps: { type: 'string' },
        out: { type: 'string' },
        check: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(describeError(error));
  }
  return {
    help: values.help ?? false,
    csv: values.csv ?? DEFAULT_FULL_CSV,
    dumps: values.dumps ?? DEFAULT_DUMPS_DIRECTORY,
    out: values.out ?? DEFAULT_FIXES_FILE,
    check: values.check ?? false,
  };
}

/**
 * `npm run import:fixes`: builds data/text-fixes.json from the full CSV and the
 * API dumps. Returns the exit code instead of exiting, so tests can call it.
 */
export async function runFixesCli(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  let options: FixesOptions;
  try {
    options = parseFixesArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(`${error.message}\n\n${FIXES_USAGE}`);
    return EXIT_USAGE;
  }
  if (options.help) {
    io.out(FIXES_USAGE);
    return EXIT_OK;
  }

  try {
    return await buildFixesFile(options, io);
  } catch (error) {
    io.err(describeError(error));
    return EXIT_FAILED;
  }
}

async function buildFixesFile(
  options: FixesOptions,
  io: CliIo,
): Promise<number> {
  const rows = await readZomatoCsv(options.csv);
  const dumpFiles = await findDumpFiles(options.dumps);
  const reference = await readReferenceTexts(dumpFiles);

  io.out(
    `Read ${rows.length.toLocaleString('en-US')} CSV rows and ` +
      `${reference.records.toLocaleString('en-US')} dump records ` +
      `(${reference.byId.size.toLocaleString('en-US')} restaurants) from ${dumpFiles.length} dump files.`,
  );

  if (reference.conflictingIds.size > 0) {
    const ids = [...reference.conflictingIds].slice(0, 10).join(', ');
    io.err(
      `The dumps disagree with each other about ${reference.conflictingIds.size} restaurants ` +
        `(ids: ${ids}). They should repeat the same text, so something is wrong with the files.`,
    );
    return EXIT_FAILED;
  }

  const { fixes, summary } = buildTextFixes(rows, reference.byId);
  const fieldCounts = TEXT_FIELDS.map(
    (field) => `${field} ${summary.fixedFields[field]}`,
  ).join(', ');
  io.out(
    `${summary.withReference.toLocaleString('en-US')} CSV rows have reference text. ` +
      `${summary.fixedRows.toLocaleString('en-US')} need a fix (${fieldCounts}).`,
  );

  if (summary.unrepairable.length > 0) {
    const ids = summary.unrepairable.slice(0, 10).join(', ');
    io.err(
      `${summary.unrepairable.length} rows have non-ASCII text but no reference text to repair it from ` +
        `(ids: ${ids}). Check that all five dump files are in "${options.dumps}".`,
    );
    return EXIT_FAILED;
  }

  const wanted = serialiseTextFixes(fixes);
  const current = await readIfExists(options.out);
  const upToDate = current === wanted;

  if (options.check) {
    if (upToDate) {
      io.out(`${options.out} is up to date.`);
      return EXIT_OK;
    }
    io.err(
      `${options.out} is ${current === undefined ? 'missing' : 'out of date'}. ` +
        'Rebuild it with: npm run import:fixes',
    );
    return EXIT_FAILED;
  }

  if (upToDate) {
    io.out(`${options.out} is already up to date; nothing written.`);
    return EXIT_OK;
  }
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, wanted, 'utf8');
  io.out(
    `Wrote ${options.out} (${summary.fixedRows.toLocaleString('en-US')} restaurants).`,
  );
  return EXIT_OK;
}

/** file1.json, file2.json ... The order does not matter: the dumps must agree with each other. */
async function findDumpFiles(directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    throw new Error(
      `Could not read the folder "${directory}": ${describeError(error)}. ` +
        'Unzip the take-home archive there, or pass --dumps <folder>.',
      { cause: error },
    );
  }
  const dumps = names.filter((name) => /^file\d+\.json$/.test(name)).sort();
  if (dumps.length === 0) {
    throw new Error(
      `No file1.json, file2.json ... found in "${directory}". ` +
        'Unzip the take-home archive there, or pass --dumps <folder>.',
    );
  }
  return dumps.map((name) => join(directory, name));
}

/** The file's text with Windows line endings normalised, or undefined when it does not exist. */
async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
