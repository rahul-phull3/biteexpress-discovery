// Makes the file paths in coverage/lcov.info relative to the project folder:
//   SF:C:\work\biteexpress-discovery\src\app.module.ts   becomes   SF:src/app.module.ts
//
// The SonarQube scanner runs in a container that sees the project at /usr/src. An
// absolute path from your machine would match no file there, and the coverage would
// show as 0%. Safe to run twice: a path that is already relative is left alone.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function relativizeLcov(text, root) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith('SF:')) return line;
      const file = line.slice('SF:'.length);
      if (!isAbsolute(file)) return line;
      return `SF:${relative(root, file).split(sep).join('/')}`;
    })
    .join('\n');
}

function main() {
  const root = process.cwd();
  const report = resolve(root, 'coverage', 'lcov.info');
  if (!existsSync(report)) {
    console.error('coverage/lcov.info not found. Run `npm run test:cov` first.');
    process.exit(1);
  }
  const before = readFileSync(report, 'utf8');
  const after = relativizeLcov(before, root);
  writeFileSync(report, after);
  const files = after.split(/\r?\n/).filter((line) => line.startsWith('SF:')).length;
  console.log(`coverage/lcov.info: ${files} source files, paths relative to the project folder.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
