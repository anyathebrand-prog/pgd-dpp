/**
 * APP-05 — the server's own view of a photograph.
 *
 * A unit test because it is pure and because it is the half of the check that
 * an attacker cannot skip: the cropper in the browser is a courtesy, and this
 * is the rule. The buffers below are built byte by byte rather than loaded
 * from fixtures, so what each test asserts is visible in the test.
 */
import { describe, expect, it } from 'vitest';
import {
  PHOTO_MIN_HEIGHT,
  PHOTO_MIN_WIDTH,
  imageSize,
  photoProblem,
} from '@/lib/image';

/** A PNG header: signature, then an IHDR chunk carrying width and height. */
function png(width: number, height: number) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/**
 * A JPEG with an APP0 segment before the frame header, which is what every
 * camera and phone actually produces — the frame is never the first segment.
 */
function jpeg(width: number, height: number, { marker = 0xc0 } = {}) {
  const app0 = Buffer.alloc(20);
  app0.writeUInt16BE(0xffd8, 0);
  app0.writeUInt16BE(0xffe0, 2);
  app0.writeUInt16BE(16, 4); // length
  app0.write('JFIF\0', 6, 'ascii');

  const sof = Buffer.alloc(11);
  sof.writeUInt8(0xff, 0);
  sof.writeUInt8(marker, 1);
  sof.writeUInt16BE(8, 2); // length
  sof.writeUInt8(8, 4); // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([app0, sof]);
}

describe('reading dimensions out of a header', () => {
  it('reads a PNG', () => {
    expect(imageSize(png(413, 531))).toEqual({ width: 413, height: 531 });
  });

  it('reads a JPEG whose frame header comes after other segments', () => {
    expect(imageSize(jpeg(600, 771))).toEqual({ width: 600, height: 771 });
  });

  it('reads a progressive JPEG, which uses a different frame marker', () => {
    // SOF2. Phones produce these, and treating one as unreadable would reject
    // a perfectly good photograph.
    expect(imageSize(jpeg(600, 771, { marker: 0xc2 }))).toEqual({ width: 600, height: 771 });
  });

  it('is not fooled by the Huffman table marker, which is in the same range', () => {
    // 0xC4 sits inside C0–CF but is not a frame; reading it as one would
    // return whatever two bytes happened to follow.
    const dht = Buffer.alloc(13);
    dht.writeUInt16BE(0xffd8, 0);
    dht.writeUInt8(0xff, 2);
    dht.writeUInt8(0xc4, 3);
    dht.writeUInt16BE(4, 4);
    dht.writeUInt16BE(0xffda, 8); // start of scan — no frame at all
    expect(imageSize(dht)).toBeNull();
  });

  it('returns nothing for something that is not an image', () => {
    expect(imageSize(Buffer.from('%PDF-1.7 this is a pdf', 'ascii'))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
  });
});

describe('whether a photograph can be used', () => {
  it('accepts one at the print floor', () => {
    expect(photoProblem({ width: PHOTO_MIN_WIDTH, height: PHOTO_MIN_HEIGHT })).toBeNull();
  });

  it('accepts a larger one in the same proportion', () => {
    expect(photoProblem({ width: 826, height: 1062 })).toBeNull();
  });

  it('rejects one too small to print, and says the numbers', () => {
    const problem = photoProblem({ width: 200, height: 257 });
    // "Invalid image" sends somebody back to a camera roll with nothing to
    // look for.
    expect(problem).toMatch(/200×257/);
    expect(problem).toMatch(/413×531/);
  });

  it('rejects a landscape photograph as the wrong shape', () => {
    expect(photoProblem({ width: 1200, height: 800 })).toMatch(/wrong shape/);
  });

  it('rejects a square one, which is the usual mistake', () => {
    expect(photoProblem({ width: 800, height: 800 })).toMatch(/wrong shape/);
  });

  it('rejects a file it could not read at all', () => {
    expect(photoProblem(null)).toMatch(/JPEG or PNG/);
  });
});
