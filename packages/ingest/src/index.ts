export * from './parser';
export * from './stub';
export * from './llm';

import type { InvoiceParser } from './parser';
import { StubParser } from './stub';
import { LlmParser } from './llm';

const stub = new StubParser();

export const parserRegistry: Record<string, InvoiceParser> = {
  stub,
  llm: new LlmParser(),
};

/** Look up a parser by id; unknown or missing ids fall back to the stub. */
export function getParser(id?: string): InvoiceParser {
  if (id === undefined) return stub;
  return parserRegistry[id] ?? stub;
}
