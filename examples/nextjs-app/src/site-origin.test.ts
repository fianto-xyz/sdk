import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteOrigin } from './site-origin.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('siteOrigin', () => {
  it('falls back to the request origin outside production when SITE_URL is unset', () => {
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(siteOrigin(new Request('http://localhost:3000/api/checkout'))).toBe('http://localhost:3000');
  });

  it('uses SITE_URL when set, even outside production', () => {
    vi.stubEnv('SITE_URL', 'https://shop.example');
    vi.stubEnv('NODE_ENV', 'development');
    expect(siteOrigin(new Request('http://localhost:3000/api/checkout'))).toBe('https://shop.example');
  });

  it('throws in production when SITE_URL is unset', () => {
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => siteOrigin(new Request('http://localhost:3000/api/checkout'))).toThrow(/SITE_URL must be set/);
  });

  it('throws in production when SITE_URL is not https', () => {
    vi.stubEnv('SITE_URL', 'http://shop.example');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => siteOrigin(new Request('http://localhost:3000/api/checkout'))).toThrow(/SITE_URL must be https/);
  });

  it('accepts an https SITE_URL in production', () => {
    vi.stubEnv('SITE_URL', 'https://shop.example');
    vi.stubEnv('NODE_ENV', 'production');
    expect(siteOrigin(new Request('http://localhost:3000/api/checkout'))).toBe('https://shop.example');
  });
});
