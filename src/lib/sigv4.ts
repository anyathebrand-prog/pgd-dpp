import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4, for Cloudflare R2's S3-compatible API.
 *
 * Hand-written on node:crypto instead of pulling in the AWS SDK, for the
 * same reason the Paystack and OIDC clients are: four operations (put, get,
 * head, delete) do not justify a dependency tree that size, and a signer
 * this small is checked against Amazon's own published example in
 * tests/sigv4.test.ts rather than taken on trust.
 *
 * Every request signs its payload hash (x-amz-content-sha256), so R2
 * refuses a body altered in transit.
 */

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, which is what SigV4 means by "URI-encode". */
function uriEncode(value: string, keepSlash: boolean) {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? encoded.replace(/%2F/g, '/') : encoded;
}

export type SignInput = {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  /** Full URL, e.g. https://{account}.r2.cloudflarestorage.com/{bucket}/{key} */
  url: string;
  headers?: Record<string, string>;
  body?: Buffer;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** For tests. Defaults to now. */
  date?: Date;
};

export function signRequest(input: SignInput) {
  const url = new URL(input.url);
  const service = input.service ?? 's3';
  const amzDate = (input.date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(input.body ?? '');

  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    host: url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');

  // The path is already percent-encoded by URL; S3 does not double-encode.
  const canonicalPath = url.pathname
    .split('/')
    .map((segment) => uriEncode(decodeURIComponent(segment), false))
    .join('/');
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  // fetch sets Host itself, from the URL that was signed.
  const { host: _host, ...sendable } = headers;
  void _host;
  const signed: Record<string, string> = {
    ...sendable,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  return { signature, headers: signed };
}
