import type { ZodError, ZodType } from 'zod';
import { validationFailed } from './errors.js';

/** Flattens Zod issues into `{ field: [messages] }`. Unknown keys are reported per key. */
export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        (out[key] ??= []).push('This field is not allowed.');
      }
      continue;
    }
    const key = issue.path.length ? issue.path.join('.') : '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function parseOrThrow<S extends ZodType>(schema: S, input: unknown) {
  const result = schema.safeParse(input);
  if (!result.success) throw validationFailed(zodFieldErrors(result.error));
  return result.data as S['_output'];
}
