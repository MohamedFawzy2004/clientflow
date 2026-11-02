import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL must be set to run API tests.');
if (testUrl === process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
  throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL.');
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
