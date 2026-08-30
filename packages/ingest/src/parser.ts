import type { ActualLine } from '@rafter/types';

/**
 * Invoice → draft-line-item seam.
 *
 * D5 — parsers produce DRAFT suggestions only. The contractor confirms every
 * line before it enters the record, and nothing here ever touches the pricing
 * path.
 */
export interface InvoiceParser {
  readonly id: string;
  parseDraft(text: string): Promise<ActualLine[]>;
}
