import { UsageError } from './config.js';

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const PATTERN = /^(\d+)(s|m|h|d)$/;

/** '30s' | '10m' | '2h' | '1d' -> milliseconds. Anything else throws `UsageError`. */
export function parseDuration(text: string): number {
  const match = PATTERN.exec(text);
  if (!match) {
    throw new UsageError(`Invalid duration (${text}): expected a number followed by s, m, h or d, e.g. 5m.`);
  }
  return Number(match[1]) * UNITS[match[2]!]!;
}

/** The inverse of `parseDuration` for a value it could have produced: milliseconds -> '5m' etc. Falls back to '<n>ms'. */
export function formatDuration(ms: number): string {
  if (ms !== 0 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms !== 0 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms !== 0 && ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms !== 0 && ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}
