import { MeasurementInput } from '@rafter/types';
import type { MeasurementProvider } from './provider';

/**
 * Fixture-backed stand-in for an aerial measurement vendor (D9).
 * NO network. Pick is deterministic: djb2-style hash of the lowercased
 * address, mod fixture count.
 */
export const AERIAL_FIXTURES: readonly MeasurementInput[] = [
  {
    roofAreaSqFt: 1400, pitchTwelfths: 4, stories: 1, facets: 4,
    ridgeHipLf: 42, valleyLf: 0, eaveLf: 120, rakeLf: 66,
    flashingLf: 18, penetrations: 5, existingLayers: 1,
    deckingCondition: 'GOOD',
  },
  {
    roofAreaSqFt: 1750, pitchTwelfths: 5, stories: 1, facets: 6,
    ridgeHipLf: 52, valleyLf: 14, eaveLf: 132, rakeLf: 72,
    flashingLf: 21, penetrations: 6, existingLayers: 1,
    deckingCondition: 'UNKNOWN',
  },
  {
    roofAreaSqFt: 2100, pitchTwelfths: 6, stories: 1, facets: 8,
    ridgeHipLf: 64, valleyLf: 24, eaveLf: 146, rakeLf: 80,
    flashingLf: 24, penetrations: 8, existingLayers: 2,
    deckingCondition: 'SUSPECT',
  },
  {
    roofAreaSqFt: 2400, pitchTwelfths: 7, stories: 2, facets: 10,
    ridgeHipLf: 70, valleyLf: 30, eaveLf: 118, rakeLf: 84,
    flashingLf: 28, penetrations: 9, existingLayers: 1,
    deckingCondition: 'UNKNOWN',
  },
  {
    roofAreaSqFt: 2800, pitchTwelfths: 8, stories: 2, facets: 14,
    ridgeHipLf: 82, valleyLf: 44, eaveLf: 128, rakeLf: 92,
    flashingLf: 32, penetrations: 11, existingLayers: 1,
    deckingCondition: 'GOOD',
  },
  {
    roofAreaSqFt: 3200, pitchTwelfths: 9, stories: 2, facets: 18,
    ridgeHipLf: 94, valleyLf: 58, eaveLf: 138, rakeLf: 98,
    flashingLf: 36, penetrations: 12, existingLayers: 2,
    deckingCondition: 'SUSPECT',
  },
  {
    roofAreaSqFt: 3700, pitchTwelfths: 10, stories: 2, facets: 22,
    ridgeHipLf: 104, valleyLf: 70, eaveLf: 150, rakeLf: 106,
    flashingLf: 40, penetrations: 14, existingLayers: 1,
    deckingCondition: 'UNKNOWN',
  },
  {
    roofAreaSqFt: 4200, pitchTwelfths: 12, stories: 2, facets: 28,
    ridgeHipLf: 118, valleyLf: 86, eaveLf: 160, rakeLf: 112,
    flashingLf: 46, penetrations: 16, existingLayers: 2,
    deckingCondition: 'GOOD',
  },
];

/** Simple deterministic 32-bit string hash (djb2 xor variant). */
export function hashAddress(address: string): number {
  const s = address.toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export class StubAerialProvider implements MeasurementProvider {
  readonly id = 'AERIAL_STUB' as const;

  async getMeasurement(req: {
    address?: string;
    input?: MeasurementInput;
  }): Promise<{ input: MeasurementInput; providerRef?: string }> {
    if (req.address === undefined || req.address.trim() === '') {
      throw new Error('AERIAL_STUB measurement requires an address');
    }
    const hash = hashAddress(req.address);
    const fixture = AERIAL_FIXTURES[hash % AERIAL_FIXTURES.length]!;
    // Parse returns a fresh validated copy so callers cannot mutate fixtures.
    const input = MeasurementInput.parse(fixture);
    return { input, providerRef: `stub:${hash}` };
  }
}
