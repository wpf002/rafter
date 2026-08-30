import {
  fromMoney,
  type Closeout,
  type CloseoutInput,
  type MoneyString,
  type Quote,
  type QuoteComputation,
} from '@rafter/types';

/**
 * Repo rows carry bigint cents (D1). Wire DTOs carry MoneyString and ISO
 * dates. These helpers are the ONLY place a repo row is turned into JSON —
 * a raw bigint must never reach JSON.stringify.
 */

/** Shape of the Prisma quote row returned by quotes.issue (bigint money). */
export interface QuoteRow {
  id: string;
  jobId: string;
  issuedAt: Date;
}

/**
 * The engine computation is already wire-safe (MoneyString throughout, D2);
 * only the row's identity fields are merged in. Never spread the Prisma row —
 * it carries bigint columns.
 */
export function quoteToWire(computation: QuoteComputation, row: QuoteRow): Quote {
  return {
    ...computation,
    id: row.id,
    jobId: row.jobId,
    issuedAt: row.issuedAt.toISOString(),
  };
}

/** Shape of the Prisma closeout row returned by closeouts.submit (bigint money). */
export interface CloseoutRow {
  id: string;
  jobId: string;
  submittedAt: Date;
  actualCostCents: bigint;
  varianceCents: bigint;
  attributedCents: bigint;
  unattributedCents: bigint;
}

export type CloseoutWire = Closeout & {
  actualCostCents: MoneyString;
  varianceCents: MoneyString;
  attributedCents: MoneyString;
  unattributedCents: MoneyString;
};

export function closeoutToWire(row: CloseoutRow, input: CloseoutInput): CloseoutWire {
  return {
    id: row.id,
    jobId: row.jobId,
    submittedAt: row.submittedAt.toISOString(),
    actualCostCents: fromMoney(row.actualCostCents),
    varianceCents: fromMoney(row.varianceCents),
    attributedCents: fromMoney(row.attributedCents),
    unattributedCents: fromMoney(row.unattributedCents),
    actualLines: input.actualLines,
    attributions: input.attributions,
  };
}

/** Content type for a stored photo, from its filename extension. */
export function contentTypeForFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}
