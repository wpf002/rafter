/** Route-level HTTP failure with a human message. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Extract the raised Postgres message from a Prisma error, e.g.
 *   "Raw query failed. Code: `P0001`. Message: `job cannot close: ...`"
 *   'ConnectorError { ... message: "issued quotes are immutable" ... }'
 */
export function postgresMessage(message: string): string {
  const m =
    /Message: `([^`]+)`/.exec(message) ?? /message: "((?:[^"\\]|\\.)*)"/.exec(message);
  return m?.[1] ?? message;
}
