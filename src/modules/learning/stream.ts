import 'server-only';
import { streamState } from './stream-token';

/**
 * LRN-02 — the Cloudflare Stream driver.
 *
 * Configured by environment, like mail and payments: with the five variables
 * below set, lesson video is uploaded to Stream, transcoded into an
 * adaptive-bitrate HLS ladder, and played through signed URLs. Without them,
 * it falls back to progressive MP4 from object storage (`/api/video/{uid}`),
 * which works everywhere but does not adapt to the connection. Development
 * runs the fallback, so the test suite exercises it end to end.
 *
 *   CLOUDFLARE_ACCOUNT_ID            the account that owns Stream
 *   CLOUDFLARE_STREAM_TOKEN          API token with Stream:Edit
 *   CLOUDFLARE_STREAM_CUSTOMER_CODE  the `customer-…` subdomain for playback
 *   CLOUDFLARE_STREAM_KEY_ID         a signing key, from POST /stream/keys
 *   CLOUDFLARE_STREAM_KEY_PEM        that key's `pem`, as returned (base64)
 */

export function streamConfig() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_TOKEN;
  const customerCode = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  const keyId = process.env.CLOUDFLARE_STREAM_KEY_ID;
  const keyPem = process.env.CLOUDFLARE_STREAM_KEY_PEM;
  if (!account || !token || !customerCode || !keyId || !keyPem) return null;
  return { account, token, customerCode, keyId, keyPem };
}

type Config = NonNullable<ReturnType<typeof streamConfig>>;

async function api(cfg: Config, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/stream${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    result?: { uid?: string; status?: { state?: string }; duration?: number };
    errors?: { message: string }[];
  };
  if (!res.ok || body.success === false) {
    throw new Error(body.errors?.map((e) => e.message).join('; ') || `Stream answered ${res.status}`);
  }
  return body.result ?? {};
}

/**
 * Uploads a recording (≤200MB, Stream's single-request limit and ours) and
 * locks it to signed playback before returning. The institution travels in
 * the video's metadata, so anything reading it back knows whose it is
 * without a cross-tenant lookup.
 */
export async function uploadToStream(
  cfg: Config,
  file: File,
  meta: { institutionId: string; lessonId: string },
) {
  const form = new FormData();
  form.append('file', file, file.name || 'lesson.mp4');
  const created = await api(cfg, '', { method: 'POST', body: form });
  const uid = String(created.uid ?? '');
  if (!uid) throw new Error('Stream returned no uid');

  // Until this lands the video is publicly playable by uid, so a failure
  // here deletes the upload rather than leaving it open.
  try {
    await api(cfg, `/${uid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requireSignedURLs: true, meta: { ...meta, name: file.name } }),
    });
  } catch (err) {
    await api(cfg, `/${uid}`, { method: 'DELETE' }).catch(() => {});
    throw err;
  }
  return uid;
}

export async function streamStatus(cfg: Config, uid: string) {
  const video = await api(cfg, `/${uid}`);
  return {
    state: streamState(video.status?.state),
    durationSeconds: video.duration && video.duration > 0 ? Math.round(video.duration) : null,
  };
}
