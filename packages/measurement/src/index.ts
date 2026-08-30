export * from './provider';
export * from './manual';
export * from './aerial-stub';

import type { MeasurementSource } from '@rafter/types';
import type { MeasurementProvider } from './provider';
import { ManualEntryProvider } from './manual';
import { StubAerialProvider } from './aerial-stub';

export const providerRegistry: Record<MeasurementSource, MeasurementProvider> = {
  MANUAL: new ManualEntryProvider(),
  AERIAL_STUB: new StubAerialProvider(),
};
