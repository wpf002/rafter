import type { MeasurementInput, MeasurementSource } from '@rafter/types';

/**
 * D9 — measurement providers are swappable adapters behind this seam.
 * No vendor names leak past this interface (and never into the engine).
 */
export interface MeasurementProvider {
  readonly id: MeasurementSource;
  getMeasurement(req: {
    address?: string;
    input?: MeasurementInput;
  }): Promise<{ input: MeasurementInput; providerRef?: string }>;
}
