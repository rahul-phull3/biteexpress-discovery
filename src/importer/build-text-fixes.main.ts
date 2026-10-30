/**
 * Entry point of `npm run import:fixes`. All the logic is in fixes-cli.ts; this
 * file only connects it to the process: the arguments, the console and the
 * exit code.
 */
import { runFixesCli } from './fixes-cli';

runFixesCli(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exitCode = 1;
  });
