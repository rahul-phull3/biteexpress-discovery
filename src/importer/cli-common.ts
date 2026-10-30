/** Where a command line tool writes. The real one is the console; tests pass their own. */
export interface CliIo {
  /** Normal output: the report. */
  out(text: string): void;
  /** Problems and usage errors. */
  err(text: string): void;
}

/** What a tool returns to the shell as its exit code. */
export const EXIT_OK = 0;
/** The run happened but did not succeed: a bad file, rejected rows, a database problem, a failed check. */
export const EXIT_FAILED = 1;
/** The command was used wrongly: an unknown option, a bad value, a bad configuration. */
export const EXIT_USAGE = 2;

/** The command line itself is wrong. The tool shows the message and its usage text. */
export class UsageError extends Error {}
