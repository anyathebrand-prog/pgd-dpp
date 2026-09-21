/**
 * LRN-02 — signed adaptive-bitrate playback.
 */
import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { playbackTtl, playbackUrls, signStreamToken, streamState } from '@/modules/learning/stream-token';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM_B64 = Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).toString('base64');

describe('playback token', () => {
  const NOW = 1_800_000_000;
  const token = signStreamToken({ keyId: 'key-1', pemBase64: PEM_B64, uid: 'vid-abc', ttlSeconds: 7200, now: NOW });
  const [h, b, s] = token.split('.');

  it('is RS256, verifiable with the key it was signed by', () => {
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toMatchObject({ alg: 'RS256', kid: 'key-1' });
    expect(verify('sha256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('names one video, expires, and does not allow download', () => {
    expect(JSON.parse(Buffer.from(b, 'base64url').toString())).toEqual({
      sub: 'vid-abc',
      kid: 'key-1',
      exp: NOW + 7200,
      nbf: NOW - 60,
      downloadable: false,
    });
  });
});

describe('lifetime', () => {
  it('is the recording plus an hour, capped at four', () => {
    expect(playbackTtl(1800)).toBe(5400);
    expect(playbackTtl(null)).toBe(7200);
    expect(playbackTtl(5 * 3600)).toBe(4 * 3600);
  });
});

describe('urls and states', () => {
  it('puts the token in the path, as Stream requires', () => {
    expect(playbackUrls('abc123', 'T')).toEqual({
      iframe: 'https://customer-abc123.cloudflarestream.com/T/iframe?preload=none&letterboxColor=transparent',
      hls: 'https://customer-abc123.cloudflarestream.com/T/manifest/video.m3u8',
    });
  });

  it('reduces Cloudflare states to three', () => {
    expect(streamState('ready')).toBe('ready');
    expect(streamState('error')).toBe('error');
    expect(['queued', 'downloading', 'inprogress', undefined].map(streamState)).toEqual(Array(4).fill('processing'));
  });
});
