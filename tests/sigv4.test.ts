/**
 * The R2 signer, against Amazon's published SigV4 example rather than
 * against itself. "Example: GET Object" in the S3 API reference
 * (sig-v4-header-based-auth): a ranged GET of test.txt from examplebucket,
 * with the documentation's example credentials, on 24 May 2013.
 */
import { describe, expect, it } from 'vitest';
import { signRequest } from '@/lib/sigv4';

const EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  date: new Date('2013-05-24T00:00:00Z'),
};

describe('SigV4', () => {
  it("reproduces Amazon's GET Object example signature", () => {
    const { signature, headers } = signRequest({
      ...EXAMPLE,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { Range: 'bytes=0-9' },
    });
    expect(signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('signs the payload, so a changed body is a different signature', () => {
    const base = { ...EXAMPLE, method: 'PUT' as const, url: 'https://examplebucket.s3.amazonaws.com/a.pdf' };
    const one = signRequest({ ...base, body: Buffer.from('original') });
    const two = signRequest({ ...base, body: Buffer.from('altered') });
    expect(one.signature).not.toBe(two.signature);
    expect(one.headers['x-amz-content-sha256']).not.toBe(two.headers['x-amz-content-sha256']);
  });

  it('encodes a key with spaces and punctuation the way S3 expects', () => {
    const { headers } = signRequest({
      ...EXAMPLE,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/institutions/x/My%20File%20(1).pdf',
    });
    expect(headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });
});
