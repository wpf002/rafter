import { describe, expect, it } from 'vitest';
import { MeasurementInput } from '@rafter/types';
import {
  AERIAL_FIXTURES,
  ManualEntryProvider,
  StubAerialProvider,
  hashAddress,
  providerRegistry,
} from '../src/index';

const valid: MeasurementInput = {
  roofAreaSqFt: 2430,
  pitchTwelfths: 8,
  stories: 2,
  facets: 12,
  ridgeHipLf: 80,
  valleyLf: 40,
  eaveLf: 130,
  rakeLf: 90,
  flashingLf: 30,
  penetrations: 10,
  existingLayers: 1,
  roofAgeYears: 12,
  deckingCondition: 'UNKNOWN',
};

describe('ManualEntryProvider', () => {
  const manual = new ManualEntryProvider();

  it('has id MANUAL', () => {
    expect(manual.id).toBe('MANUAL');
  });

  it('accepts a valid input and returns a validated copy', async () => {
    const res = await manual.getMeasurement({ input: valid });
    expect(res.input).toEqual(valid);
    expect(res.input).not.toBe(valid); // fresh copy, fixtures not shared
    expect(res.providerRef).toBeUndefined();
  });

  it('applies the deckingCondition default when omitted', async () => {
    const { deckingCondition: _omit, ...rest } = valid;
    const res = await manual.getMeasurement({ input: rest as MeasurementInput });
    expect(res.input.deckingCondition).toBe('UNKNOWN');
  });

  it('throws when input is missing', async () => {
    await expect(manual.getMeasurement({ address: '1 Main St' })).rejects.toThrow(
      /requires an input/,
    );
  });

  it('rejects a non-positive roof area', async () => {
    await expect(
      manual.getMeasurement({ input: { ...valid, roofAreaSqFt: 0 } }),
    ).rejects.toThrow();
  });

  it('rejects non-integer quantities (floats are never allowed)', async () => {
    await expect(
      manual.getMeasurement({ input: { ...valid, ridgeHipLf: 80.5 } }),
    ).rejects.toThrow();
  });

  it('rejects out-of-range pitch', async () => {
    await expect(
      manual.getMeasurement({ input: { ...valid, pitchTwelfths: 25 } }),
    ).rejects.toThrow();
  });
});

describe('StubAerialProvider', () => {
  const stub = new StubAerialProvider();

  it('has id AERIAL_STUB', () => {
    expect(stub.id).toBe('AERIAL_STUB');
  });

  it('is deterministic: same address twice returns identical results', async () => {
    const a = await stub.getMeasurement({ address: '742 Evergreen Terrace, Springfield' });
    const b = await stub.getMeasurement({ address: '742 Evergreen Terrace, Springfield' });
    expect(b.input).toEqual(a.input);
    expect(b.providerRef).toBe(a.providerRef);
  });

  it('hashes the lowercased address (case-insensitive pick)', async () => {
    const a = await stub.getMeasurement({ address: '100 OAK AVE' });
    const b = await stub.getMeasurement({ address: '100 oak ave' });
    expect(b.input).toEqual(a.input);
    expect(b.providerRef).toBe(a.providerRef);
  });

  it('returns at least 2 distinct fixtures across a sample of addresses', async () => {
    const addresses = [
      '1 Main St', '2 Main St', '3 Main St', '4 Main St',
      '55 Birch Rd', '900 Lake Shore Dr', '17 Elm Ct', '31 Cedar Ln',
    ];
    const areas = new Set<number>();
    for (const address of addresses) {
      const res = await stub.getMeasurement({ address });
      areas.add(res.input.roofAreaSqFt);
    }
    expect(areas.size).toBeGreaterThanOrEqual(2);
  });

  it('providerRef is stub:<hash of lowercased address>', async () => {
    const address = '742 Evergreen Terrace, Springfield';
    const res = await stub.getMeasurement({ address });
    expect(res.providerRef).toBe(`stub:${hashAddress(address)}`);
    expect(res.providerRef).toMatch(/^stub:\d+$/);
  });

  it('throws when address is missing or blank', async () => {
    await expect(stub.getMeasurement({})).rejects.toThrow(/requires an address/);
    await expect(stub.getMeasurement({ address: '   ' })).rejects.toThrow(/requires an address/);
  });

  it('ships exactly 8 fixtures, every one parses as MeasurementInput', () => {
    expect(AERIAL_FIXTURES).toHaveLength(8);
    for (const fixture of AERIAL_FIXTURES) {
      expect(() => MeasurementInput.parse(fixture)).not.toThrow();
    }
  });

  it('fixtures vary within the realistic ranges', () => {
    for (const f of AERIAL_FIXTURES) {
      expect(f.roofAreaSqFt).toBeGreaterThanOrEqual(1400);
      expect(f.roofAreaSqFt).toBeLessThanOrEqual(4200);
      expect(f.pitchTwelfths).toBeGreaterThanOrEqual(4);
      expect(f.pitchTwelfths).toBeLessThanOrEqual(12);
      expect(f.stories === 1 || f.stories === 2).toBe(true);
      expect(f.facets).toBeGreaterThanOrEqual(4);
      expect(f.facets).toBeLessThanOrEqual(28);
      expect(f.existingLayers === 1 || f.existingLayers === 2).toBe(true);
      if (f.roofAgeYears !== null) {
        expect(f.roofAgeYears).toBeGreaterThanOrEqual(6);
        expect(f.roofAgeYears).toBeLessThanOrEqual(38);
      }
    }
    expect(new Set(AERIAL_FIXTURES.map((f) => f.roofAreaSqFt)).size).toBe(8);
    // roofAgeYears is sometimes unknown — exactly one null fixture.
    expect(AERIAL_FIXTURES.filter((f) => f.roofAgeYears === null)).toHaveLength(1);
  });
});

describe('providerRegistry', () => {
  it('maps every MeasurementSource to a provider with a matching id', () => {
    expect(Object.keys(providerRegistry).sort()).toEqual(['AERIAL_STUB', 'MANUAL']);
    expect(providerRegistry.MANUAL.id).toBe('MANUAL');
    expect(providerRegistry.AERIAL_STUB.id).toBe('AERIAL_STUB');
  });
});
