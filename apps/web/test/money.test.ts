import { describe, expect, it } from 'vitest';
import {
  bpsToMultiplierInput,
  bpsToPercentInput,
  centsToDollarsInput,
  formatQtyX100,
  parseCount,
  parseDollarsToCents,
  parseMultiplierToBps,
  parsePercentToBps,
  sumMoney,
} from '../src/lib/money';

describe('parseDollarsToCents', () => {
  it('parses plain dollars', () => {
    expect(parseDollarsToCents('120')).toBe(12000n);
  });

  it('parses dollars and cents', () => {
    expect(parseDollarsToCents('1234.56')).toBe(123456n);
  });

  it('parses with $ and thousands separators', () => {
    expect(parseDollarsToCents('$12,345.00')).toBe(1234500n);
  });

  it('pads a single decimal digit', () => {
    expect(parseDollarsToCents('45.5')).toBe(4550n);
  });

  it('parses a bare fraction', () => {
    expect(parseDollarsToCents('.75')).toBe(75n);
  });

  it('parses negatives', () => {
    expect(parseDollarsToCents('-45.50')).toBe(-4550n);
  });

  it('parses zero', () => {
    expect(parseDollarsToCents('0')).toBe(0n);
  });

  it('handles values beyond Number safe-integer range exactly', () => {
    expect(parseDollarsToCents('92233720368547758.08')).toBe(9223372036854775808n);
  });

  it('rejects garbage', () => {
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('-')).toBeNull();
    expect(parseDollarsToCents('.')).toBeNull();
    expect(parseDollarsToCents('1.234')).toBeNull();
    expect(parseDollarsToCents('1e5')).toBeNull();
  });
});

describe('centsToDollarsInput', () => {
  it('renders cents as an editable dollars string', () => {
    expect(centsToDollarsInput(123456n)).toBe('1234.56');
  });

  it('pads cents', () => {
    expect(centsToDollarsInput(5n)).toBe('0.05');
  });

  it('handles negatives', () => {
    expect(centsToDollarsInput(-4550n)).toBe('-45.50');
  });

  it('round-trips with parseDollarsToCents', () => {
    for (const v of [0n, 1n, 99n, 100n, 123456789n, -250n]) {
      expect(parseDollarsToCents(centsToDollarsInput(v))).toBe(v);
    }
  });
});

describe('parsePercentToBps / bpsToPercentInput', () => {
  it('parses percents to bps', () => {
    expect(parsePercentToBps('15.5')).toBe(1550);
    expect(parsePercentToBps('10')).toBe(1000);
    expect(parsePercentToBps('0.25')).toBe(25);
    expect(parsePercentToBps('100%')).toBe(10000);
  });

  it('rejects garbage', () => {
    expect(parsePercentToBps('')).toBeNull();
    expect(parsePercentToBps('x')).toBeNull();
    expect(parsePercentToBps('1.234')).toBeNull();
  });

  it('formats bps back to a percent string', () => {
    expect(bpsToPercentInput(1550)).toBe('15.50');
    expect(bpsToPercentInput(0)).toBe('0.00');
  });
});

describe('parseMultiplierToBps / bpsToMultiplierInput', () => {
  it('parses multipliers to bps', () => {
    expect(parseMultiplierToBps('1.15')).toBe(11500);
    expect(parseMultiplierToBps('1')).toBe(10000);
    expect(parseMultiplierToBps('0.85')).toBe(8500);
    expect(parseMultiplierToBps('×1.05')).toBe(10500);
    expect(parseMultiplierToBps('1.1275')).toBe(11275);
  });

  it('rejects garbage', () => {
    expect(parseMultiplierToBps('')).toBeNull();
    expect(parseMultiplierToBps('abc')).toBeNull();
    expect(parseMultiplierToBps('1.12345')).toBeNull();
  });

  it('formats bps back to a multiplier string', () => {
    expect(bpsToMultiplierInput(11500)).toBe('1.15');
    expect(bpsToMultiplierInput(10000)).toBe('1');
    expect(bpsToMultiplierInput(11275)).toBe('1.1275');
  });
});

describe('parseCount', () => {
  it('parses non-negative integers', () => {
    expect(parseCount('0')).toBe(0);
    expect(parseCount(' 2430 ')).toBe(2430);
  });

  it('rejects non-integers', () => {
    expect(parseCount('')).toBeNull();
    expect(parseCount('-1')).toBeNull();
    expect(parseCount('2.5')).toBeNull();
    expect(parseCount('abc')).toBeNull();
  });
});

describe('formatQtyX100', () => {
  it('renders hundredths quantities', () => {
    expect(formatQtyX100(2430)).toBe('24.3');
    expect(formatQtyX100(2400)).toBe('24');
    expect(formatQtyX100(2435)).toBe('24.35');
    expect(formatQtyX100(0)).toBe('0');
  });

  it('groups thousands', () => {
    expect(formatQtyX100(1234500)).toBe('12,345');
  });
});

describe('sumMoney', () => {
  it('sums bigint cents exactly', () => {
    expect(sumMoney([1n, 2n, 3n])).toBe(6n);
    expect(sumMoney([])).toBe(0n);
    expect(sumMoney([-500n, 500n])).toBe(0n);
  });
});
