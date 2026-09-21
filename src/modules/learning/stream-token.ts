import { createPrivateKey, sign } from 'node:crypto';

/**
 * LRN-02 — adaptive-bitrate playback through Cloudflare Stream (§7: "do not
 * self-host video").
 *
 * Every video is uploaded with `requireSignedURLs`, so a uid on its own plays
 * nothing. Playback needs a token: an RS256 JWT, signed here with a Stream
 * signing key, naming one video and expiring. Signing locally rather than
 * asking Cloudflare's token endpoint for each view keeps a lesson page from
 * spending an API call per student, and keeps working if that endpoint is
 * slow.
 *
 * The token goes in the path of the playback URL, which is Cloudflare's
 * format, not a choice.
 */

export function signStreamToken(opts: {
  keyId: string;
  /** The `pem` from POST /stream/keys: a base64-encoded PEM private key. */
  pemBase64: string;
  uid: string;
  ttlSeconds: number;
  now?: number;
}) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: 'RS256', kid: opts.keyId, typ: 'JWT' });
  const body = enc({
    sub: opts.uid,
    kid: opts.keyId,
    exp: now + opts.ttlSeconds,
    nbf: now - 60,
    // LRN-09 governs downloads of readings; a lecture recording is not
    // offered as an MP4 download through the token either.
    downloadable: false,
  });
  const key = createPrivateKey(Buffer.from(opts.pemBase64, 'base64').toString('utf8'));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

/**
 * Long enough to watch the lesson with pauses, short enough that a copied
 * link dies the same day. The recording's length plus an hour, capped at
 * four.
 */
export function playbackTtl(durationSeconds: number | null) {
  const base = (durationSeconds ?? 3600) + 3600;
  return Math.min(base, 4 * 3600);
}

export function playbackUrls(customerCode: string, token: string) {
  const root = `https://customer-${customerCode}.cloudflarestream.com/${token}`;
  return {
    /** The Stream player: HLS with a quality selector on every browser. */
    iframe: `${root}/iframe?preload=none&letterboxColor=transparent`,
    hls: `${root}/manifest/video.m3u8`,
  };
}

/** Cloudflare's processing states, reduced to the three a lesson shows. */
export function streamState(state: string | undefined): 'ready' | 'processing' | 'error' {
  if (state === 'ready') return 'ready';
  if (state === 'error') return 'error';
  return 'processing';
}
