import { describe, expect, it } from 'vitest';
import { UsageError } from './config.js';
import { formatDuration, parseDuration } from './duration.js';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['10m', 600_000],
    ['2h', 7_200_000],
    ['1d', 86_400_000],
  ])('parses %s as %i ms', (text, ms) => {
    expect(parseDuration(text)).toBe(ms);
  });

  it.each(['10', '5x', '-1m', '', '5', '5 m'])('rejects %s as a UsageError', (text) => {
    expect(() => parseDuration(text)).toThrow(UsageError);
  });
});

describe('formatDuration', () => {
  it.each([
    [30_000, '30s'],
    [600_000, '10m'],
    [7_200_000, '2h'],
    [86_400_000, '1d'],
  ])('formats %i ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
