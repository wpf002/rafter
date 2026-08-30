import type { ActualLine } from '@rafter/types';
import type { InvoiceParser } from './parser';

/**
 * Placeholder for a future LLM-backed invoice parser. Even when configured it
 * may only ever emit DRAFT lines for contractor confirmation — never anything
 * in the pricing path (D5).
 */
export class LlmParser implements InvoiceParser {
  readonly id = 'llm';

  async parseDraft(_text: string): Promise<ActualLine[]> {
    throw new Error('LLM parser not configured — drafts only, never pricing (D5)');
  }
}
