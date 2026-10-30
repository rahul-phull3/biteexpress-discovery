/**
 * Entry point of `npm run import`. All the logic is in import-cli.ts; this file
 * only connects it to the process: the .env file, the arguments, the console
 * and the exit code.
 */
import { runImportCli } from './import-cli';

function loadDotEnv(): void {
  try {
    // Variables that are already set win over the file, as they do in the API.
    process.loadEnvFile('.env');
  } catch (error) {
    // No .env file is fine: the built-in defaults apply.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  process.exitCode = await runImportCli(
    process.argv.slice(2),
    { out: (text) => console.log(text), err: (text) => console.error(text) },
    process.env,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
