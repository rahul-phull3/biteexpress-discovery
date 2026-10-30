import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zomatoCsv, zomatoRow } from '../../test/support/zomato-rows';
import {
  DEFAULT_DUMPS_DIRECTORY,
  DEFAULT_FIXES_FILE,
  DEFAULT_FULL_CSV,
  FIXES_USAGE,
  parseFixesArgs,
  runFixesCli,
} from './fixes-cli';

/**
 * A dump record: the four texts of one restaurant, and an API key that must
 * never come out. Address, city and locality are those of zomatoRow(), so only
 * the name can differ from the CSV.
 */
function dumpRecord(id: number, name: string) {
  return {
    restaurant: {
      R: { res_id: id },
      apikey: 'SECRET-API-KEY',
      name,
      location: {
        address: '7-8, Ground Floor, Cyber Hub, DLF Cyber City, Gurgaon',
        city: 'Gurgaon',
        locality: 'Cyber Hub, DLF Cyber City',
      },
    },
  };
}

const dumpFile = (...records: ReturnType<typeof dumpRecord>[]) =>
  JSON.stringify([{ results_found: records.length, restaurants: records }]);

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text: string) => void out.push(text),
      err: (text: string) => void err.push(text),
    },
    out: () => out.join('\n'),
    err: () => err.join('\n'),
  };
}

describe('parseFixesArgs', () => {
  it('defaults to the full archive unzipped into data/full', () => {
    expect(parseFixesArgs([])).toEqual({
      help: false,
      csv: DEFAULT_FULL_CSV,
      dumps: DEFAULT_DUMPS_DIRECTORY,
      out: DEFAULT_FIXES_FILE,
      check: false,
    });
    expect(DEFAULT_FULL_CSV).toBe('data/full/zomato.csv');
    expect(DEFAULT_DUMPS_DIRECTORY).toBe('data/full');
    expect(DEFAULT_FIXES_FILE).toBe('data/text-fixes.json');
  });

  it('reads every option', () => {
    expect(
      parseFixesArgs([
        '--csv',
        'a.csv',
        '--dumps',
        'd',
        '--out',
        'o.json',
        '--check',
      ]),
    ).toEqual({
      help: false,
      csv: 'a.csv',
      dumps: 'd',
      out: 'o.json',
      check: true,
    });
  });
});

describe('runFixesCli', () => {
  let directory: string;
  let csvPath: string;
  let dumps: string;
  let counter = 0;

  /** A fresh output path for each test. */
  const outPath = () =>
    join(directory, `out-${(counter += 1)}`, 'text-fixes.json');

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'fixes-cli-'));
    dumps = join(directory, 'dumps');
    await mkdir(dumps);
    csvPath = join(directory, 'zomato.csv');
    await writeFile(
      csvPath,
      Buffer.from(
        zomatoCsv([
          zomatoRow({ 'Restaurant ID': '1', 'Restaurant Name': 'Plain Cafe' }),
          zomatoRow({ 'Restaurant ID': '2', 'Restaurant Name': 'Cafí© Roma' }),
          zomatoRow({ 'Restaurant ID': '3', 'Restaurant Name': 'Other Place' }),
        ]),
        'latin1',
      ),
    );
    // Two dump files, as in the archive. Restaurant 2 appears in both, with the same text.
    await writeFile(
      join(dumps, 'file1.json'),
      dumpFile(dumpRecord(1, 'Plain Cafe'), dumpRecord(2, 'Café Roma')),
    );
    await writeFile(
      join(dumps, 'file2.json'),
      dumpFile(
        dumpRecord(2, 'Café Roma'),
        dumpRecord(3, 'Other Place'),
        dumpRecord(99, 'Test record'),
      ),
    );
    // Files that are not dumps must be ignored.
    await writeFile(join(dumps, 'notes.json'), 'not a dump');
    await writeFile(join(dumps, 'file1.json.bak'), 'not a dump');
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const run = async (argv: string[]) => {
    const output = capture();
    const code = await runFixesCli(argv, output.io);
    return { code, out: output.out(), err: output.err() };
  };

  const base = (out: string) => [
    '--csv',
    csvPath,
    '--dumps',
    dumps,
    '--out',
    out,
  ];

  it('prints the usage and succeeds for --help', async () => {
    const result = await run(['--help']);

    expect(result).toEqual({ code: 0, out: FIXES_USAGE, err: '' });
  });

  it('returns 2 and shows the usage for a wrong option', async () => {
    const result = await run(['--nope']);

    expect(result.code).toBe(2);
    expect(result.err).toContain('--nope');
    expect(result.err).toContain(FIXES_USAGE);
  });

  it('writes the fixes for the rows whose CSV text differs from the dumps', async () => {
    const out = outPath();

    const result = await run(base(out));

    expect(result.code).toBe(0);
    expect(await readFile(out, 'utf8')).toBe(
      '{\n  "2": {\n    "name": "Café Roma"\n  }\n}\n',
    );
    expect(result.out).toContain(
      'Read 3 CSV rows and 5 dump records (4 restaurants) from 2 dump files.',
    );
    expect(result.out).toContain(
      '3 CSV rows have reference text. 1 need a fix (name 1, address 0, city 0, locality 0).',
    );
    expect(result.out).toContain(`Wrote ${out} (1 restaurants).`);
  });

  it('never writes the API key', async () => {
    const out = outPath();

    await run(base(out));

    expect(await readFile(out, 'utf8')).not.toContain('SECRET');
  });

  it('leaves the file alone when it is already right', async () => {
    const out = outPath();
    await run(base(out));
    const before = (await stat(out)).mtimeMs;

    const result = await run(base(out));

    expect(result.code).toBe(0);
    expect(result.out).toContain('already up to date; nothing written');
    expect((await stat(out)).mtimeMs).toBe(before);
  });

  it('with --check succeeds when the file is up to date, and writes nothing', async () => {
    const out = outPath();
    await run(base(out));

    const result = await run([...base(out), '--check']);

    expect(result.code).toBe(0);
    expect(result.out).toContain('is up to date.');
  });

  it('with --check fails when the file is out of date, and does not touch it', async () => {
    const out = outPath();
    await mkdir(join(out, '..'), { recursive: true });
    await writeFile(out, '{}\n');

    const result = await run([...base(out), '--check']);

    expect(result.code).toBe(1);
    expect(result.err).toContain('out of date');
    expect(result.err).toContain('npm run import:fixes');
    expect(await readFile(out, 'utf8')).toBe('{}\n');
  });

  it('with --check fails when the file is missing, and does not create it', async () => {
    const out = outPath();

    const result = await run([...base(out), '--check']);

    expect(result.code).toBe(1);
    expect(result.err).toContain('is missing');
    await expect(stat(out)).rejects.toThrow();
  });

  it('counts Windows line endings in the existing file as the same text', async () => {
    const out = outPath();
    await mkdir(join(out, '..'), { recursive: true });
    await writeFile(
      out,
      '{\r\n  "2": {\r\n    "name": "Café Roma"\r\n  }\r\n}\r\n',
    );

    const result = await run([...base(out), '--check']);

    expect(result.code).toBe(0);
  });

  it('fails, and says so, when the dumps disagree about a restaurant', async () => {
    const conflicting = join(directory, 'conflicting');
    await mkdir(conflicting);
    await writeFile(
      join(conflicting, 'file1.json'),
      dumpFile(dumpRecord(2, 'Café Roma')),
    );
    await writeFile(
      join(conflicting, 'file2.json'),
      dumpFile(dumpRecord(2, 'Café Milano')),
    );
    const out = outPath();

    const result = await run([
      '--csv',
      csvPath,
      '--dumps',
      conflicting,
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    expect(result.err).toContain(
      'disagree with each other about 1 restaurants',
    );
    await expect(stat(out)).rejects.toThrow();
  });

  it('fails when a damaged row has no reference text to repair it from', async () => {
    const partial = join(directory, 'partial');
    await mkdir(partial);
    await writeFile(
      join(partial, 'file1.json'),
      dumpFile(dumpRecord(1, 'Plain Cafe')),
    );
    const out = outPath();

    const result = await run([
      '--csv',
      csvPath,
      '--dumps',
      partial,
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    expect(result.err).toContain('no reference text');
    expect(result.err).toContain('ids: 2');
    await expect(stat(out)).rejects.toThrow();
  });

  it('fails when the folder holds no dump files', async () => {
    const empty = join(directory, 'empty');
    await mkdir(empty);

    const result = await run([
      '--csv',
      csvPath,
      '--dumps',
      empty,
      '--out',
      outPath(),
    ]);

    expect(result.code).toBe(1);
    expect(result.err).toContain('No file1.json');
    expect(result.err).toContain('Unzip the take-home archive');
  });

  it('fails when the dumps folder does not exist', async () => {
    const result = await run([
      '--csv',
      csvPath,
      '--dumps',
      join(directory, 'nowhere'),
      '--out',
      outPath(),
    ]);

    expect(result.code).toBe(1);
    expect(result.err).toContain('Could not read the folder');
  });

  it('fails, naming the file, when the CSV is missing', async () => {
    const missing = join(directory, 'missing.csv');

    const result = await run([
      '--csv',
      missing,
      '--dumps',
      dumps,
      '--out',
      outPath(),
    ]);

    expect(result.code).toBe(1);
    expect(result.err).toContain(missing);
  });
});
