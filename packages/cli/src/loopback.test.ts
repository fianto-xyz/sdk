import { describe, expect, it } from 'vitest';
import { isLoopbackUrl } from './loopback.js';

describe('isLoopbackUrl', () => {
  it.each([
    'http://localhost:3000/wh',
    'https://localhost/wh',
    'http://127.0.0.1:3000/wh',
    'http://127.0.0.1/wh',
    'http://127.5.6.7/wh',
    'http://127.255.255.255/wh',
    'http://[::1]:3000/wh',
    'http://[::1]/wh',
  ])('accepts %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  it.each([
    'http://example.com/wh',
    'https://attacker.example/wh',
    'http://126.0.0.1/wh',
    'http://128.0.0.1/wh',
    'http://localhost.attacker.example/wh',
    'http://attacker.example/?localhost',
    'http://0.0.0.0/wh',
  ])('rejects %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });

  it('rejects an unparseable URL rather than throwing', () => {
    expect(isLoopbackUrl('not-a-url')).toBe(false);
  });
});
