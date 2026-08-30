import { MeasurementInput } from '@rafter/types';
import type { MeasurementProvider } from './provider';

/** Contractor-entered measurements, validated against the shared Zod schema. */
export class ManualEntryProvider implements MeasurementProvider {
  readonly id = 'MANUAL' as const;

  async getMeasurement(req: {
    address?: string;
    input?: MeasurementInput;
  }): Promise<{ input: MeasurementInput; providerRef?: string }> {
    if (req.input === undefined) {
      throw new Error('MANUAL measurement requires an input payload');
    }
    // Throws ZodError on invalid input; returns a fresh validated copy.
    const input = MeasurementInput.parse(req.input);
    return { input };
  }
}
