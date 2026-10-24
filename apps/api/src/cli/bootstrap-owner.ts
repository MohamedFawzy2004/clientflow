// First-run CLI: creates the agency and its single OWNER (FR-I01, SEC-04).
// Usage: npm run bootstrap:owner -- --agency "Acme Studio" --name "Mona Adel" --email owner@example.com
// Password source, in order: BOOTSTRAP_OWNER_PASSWORD env var, interactive hidden prompt (TTY),
// otherwise a strong random password that is printed once.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { generateToken } from '../lib/tokens.js';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { BootstrapError, bootstrapOwner } from '../modules/auth/bootstrap.js';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    const original = output._writeToOutput.bind(rl);
    let prompted = false;
    output._writeToOutput = (s: string) => {
      if (!prompted) {
        prompted = true;
        original(s);
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      agency: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
    },
  });
  if (!values.agency || !values.name || !values.email) {
    console.error('Usage: npm run bootstrap:owner -- --agency "<agency>" --name "<owner name>" --email <email>');
    process.exit(2);
  }

  const env = loadEnv();
  let password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  let generated = false;
  if (!password && process.stdin.isTTY) {
    password = await promptHidden('Owner password (min 12 characters): ');
  }
  if (!password) {
    password = generateToken(18);
    generated = true;
  }

  const db = createDb(env.DATABASE_URL);
  try {
    const result = await bootstrapOwner(db, {
      agencyName: values.agency,
      ownerName: values.name,
      ownerEmail: values.email,
      password,
    });
    console.log(`Owner created for agency ${result.agencyId}.`);
    if (generated) {
      console.log('Generated owner password (shown once, store it in a password manager):');
      console.log(password);
    }
  } catch (err) {
    if (err instanceof BootstrapError) {
      console.error(`Bootstrap refused: ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    await db.$disconnect();
  }
}

await main();
