// Runs pg_dump / pg_restore (ADR-063). Uses the binaries on PATH when they exist (servers, CI);
// otherwise the same tools from the official postgres image through Docker (Windows development).
// The password goes through PGPASSWORD in the environment, never on a command line.
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export const PG_IMAGE = 'postgres:17.6-alpine';

export interface PgTarget {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export function parsePgUrl(url: string): PgTarget {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

function hasBinary(name: string) {
  return spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0;
}

function command(tool: 'pg_dump' | 'pg_restore', t: PgTarget, args: string[]) {
  const conn = ['-h', t.host, '-p', t.port, '-U', t.user, '-d', t.database];
  if (hasBinary(tool)) return { cmd: tool, argv: [...conn, ...args] };
  // Inside the container, the host's 127.0.0.1 is host.docker.internal.
  const host = ['127.0.0.1', 'localhost', '::1'].includes(t.host) ? 'host.docker.internal' : t.host;
  return {
    cmd: 'docker',
    argv: [
      'run',
      '--rm',
      '-i',
      '--add-host=host.docker.internal:host-gateway',
      '-e',
      'PGPASSWORD',
      PG_IMAGE,
      tool,
      ...conn.map((a) => (a === t.host ? host : a)),
      ...args,
    ],
  };
}

async function run(
  tool: 'pg_dump' | 'pg_restore',
  t: PgTarget,
  args: string[],
  io: { stdout?: string; stdin?: string },
) {
  const { cmd, argv } = command(tool, t, args);
  const child = spawn(cmd, argv, {
    env: { ...process.env, PGPASSWORD: t.password },
    stdio: [io.stdin ? 'pipe' : 'ignore', io.stdout ? 'pipe' : 'inherit', 'pipe'],
  });
  let stderr = '';
  child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
  const done = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  const streams: Promise<void>[] = [];
  if (io.stdout) streams.push(pipeline(child.stdout!, createWriteStream(io.stdout)));
  if (io.stdin) streams.push(pipeline(createReadStream(io.stdin), child.stdin!));
  const [code] = await Promise.all([done, ...streams]);
  // The password never appears in these messages; hostnames and database names may.
  if (code !== 0) throw new Error(`${tool} failed (exit ${code}): ${stderr.trim().slice(0, 500)}`);
}

/** Custom-format dump of one database into a file. */
export const pgDump = (t: PgTarget, file: string) =>
  run('pg_dump', t, ['--format=custom', '--no-owner', '--no-privileges'], { stdout: file });

/** Restores a custom-format dump into an existing, empty database. */
export const pgRestore = (t: PgTarget, file: string) =>
  run('pg_restore', t, ['--no-owner', '--no-privileges', '--exit-on-error'], { stdin: file });
