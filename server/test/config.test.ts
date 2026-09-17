import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const validEnv = {
  NODE_ENV: 'production',
  PORT: '3100',
  HOST: '0.0.0.0',
  DATABASE_URL: 'postgres://sylvan:secret-password@db:5432/sylvan',
  DEVICE_KEY: 'a'.repeat(64),
  PHOTO_DIR: '/data/photos',
  MAX_PHOTO_BYTES: '500000',
  PUBLIC_BASE_URL: 'https://sylvan.example.com/',
};

describe('loadConfig', () => {
  it('accepts a valid environment', () => {
    const config = loadConfig(validEnv);
    expect(config.port).toBe(3100);
    expect(config.photoDir).toBe('/data/photos');
    expect(config.publicBaseUrl).toBe('https://sylvan.example.com');
    expect(config.servePhotos).toBe(false);
    expect(config.trustProxy).toEqual(['127.0.0.1', '::1']);
  });

  it('serves photos by default only in development, unless overridden', () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: 'development' }).servePhotos).toBe(true);
    expect(loadConfig({ ...validEnv, SERVE_PHOTOS: 'true' }).servePhotos).toBe(true);
    expect(
      loadConfig({ ...validEnv, NODE_ENV: 'development', SERVE_PHOTOS: 'false' }).servePhotos,
    ).toBe(false);
  });

  it('rejects a DEVICE_KEY shorter than 32 characters without printing it', () => {
    const shortKey = 'short-key-1234567890';
    expect(() => loadConfig({ ...validEnv, DEVICE_KEY: shortKey })).toThrow(ConfigError);
    try {
      loadConfig({ ...validEnv, DEVICE_KEY: shortKey });
    } catch (error) {
      expect((error as Error).message).toMatch(/DEVICE_KEY: must be at least 32 characters/);
      expect((error as Error).message).not.toContain(shortKey);
    }
  });

  it('rejects the placeholder DEVICE_KEY from .env.example', () => {
    expect(() =>
      loadConfig({ ...validEnv, DEVICE_KEY: 'generate-with-openssl-rand-hex-32' }),
    ).toThrow(/DEVICE_KEY: is still the placeholder/);
  });

  it('lists every missing or invalid variable and never includes the database URL', () => {
    const { PUBLIC_BASE_URL: _publicUrl, ...withoutPublicUrl } = validEnv;
    let message = '';
    try {
      loadConfig({
        ...withoutPublicUrl,
        DATABASE_URL: 'mysql://sylvan:secret-password@db/sylvan',
        PORT: 'abc',
        DEVICE_KEY: '',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL: must be a postgres/);
    expect(message).toMatch(/PUBLIC_BASE_URL/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/DEVICE_KEY/);
    expect(message).not.toContain('secret-password');
  });
});
