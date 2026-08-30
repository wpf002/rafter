/** Engine-domain failure (bad band coverage, illegal math inputs, …). */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}
