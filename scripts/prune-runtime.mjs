// Image build only (ADR-065): after `npm ci --omit=dev`, removes every installed package the API
// and contracts do not reach at run time. npm installs all workspaces' dependencies (the web
// app's React too) and the Prisma CLI as an optional peer of @prisma/client ("devOptional"),
// which the generated client never loads. Prints what it kept and removed.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { relative, sep } from 'node:path';

const root = process.cwd();
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages;
const out = execFileSync(
  'npm',
  ['ls', '--omit=dev', '--all', '--parseable', '-w', '@clientflow/api', '-w', '@clientflow/contracts'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const reached = new Set(
  out
    .split('\n')
    .filter(Boolean)
    .map((p) => relative(root, p).split(sep).join('/'))
    .filter((p) => p.startsWith('node_modules/')),
);
let kept = 0;
let removed = 0;
for (const [path, meta] of Object.entries(lock)) {
  if (!path.startsWith('node_modules/') || meta.link) continue;
  // Packages inside other packages go with their parent.
  if (path.lastIndexOf('/node_modules/') > 0) continue;
  const needed = reached.has(path) && !meta.devOptional;
  if (needed) kept += 1;
  else {
    rmSync(path, { recursive: true, force: true });
    removed += 1;
  }
}
console.log(JSON.stringify({ kept, removed }));
