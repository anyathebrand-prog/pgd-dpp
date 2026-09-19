/**
 * APP-05 — reading an image's dimensions without decoding it.
 *
 * Hand-rolled for the same reason the TOTP and the SSO verifier are: the part
 * of the format that carries width and height is about thirty lines, while an
 * image library is a dependency that decodes attacker-supplied pixels on the
 * server. Nothing here decompresses anything — it walks the header structure
 * and reads four numbers.
 *
 * The client crops in a canvas and sends the result, but the check lives here
 * as well, because a form post is whatever the person sending it decides it
 * is. The browser's version of this is a courtesy; this one is the rule.
 */

export type Dimensions = { width: number; height: number };

/**
 * JPEG: a series of segments, each `FF <marker> <2-byte length>`. The frame
 * headers (SOF0–SOF15, excluding the four that are not frames) carry height
 * then width as 16-bit big-endian, just after a one-byte precision field.
 */
function jpegSize(buf: Buffer): Dimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < buf.length) {
    if (buf[offset] !== 0xff) {
      // Fill bytes are legal between segments; anything else is not a JPEG we
      // are willing to guess about.
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of scan: the entropy-coded image data begins, and there is no
    // frame header after it worth reading.
    if (marker === 0xda || marker === 0xd9) return null;

    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;

    const isFrame =
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc; // DAC

    if (isFrame) {
      if (offset + 9 > buf.length) return null;
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

/** PNG: the IHDR chunk is always first, and width/height are its first 8 bytes. */
function pngSize(buf: Buffer): Dimensions | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function imageSize(buf: Buffer): Dimensions | null {
  const size = pngSize(buf) ?? jpegSize(buf);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size;
}

/*
 * A passport photograph is 35×45mm. At the 300dpi a registry needs to print an
 * ID card and a certificate, that is 413×531 — so this is the floor, not a
 * preference. Below it the photograph cannot be printed at the size §6.4 uses
 * it, and a candidate who is told that after admission has to be chased.
 */
export const PHOTO_MIN_WIDTH = 413;
export const PHOTO_MIN_HEIGHT = 531;
export const PHOTO_ASPECT = 35 / 45;
/** Roughly two millimetres out on a 35mm edge, which no one can crop past. */
export const PHOTO_ASPECT_TOLERANCE = 0.04;

/**
 * Why this photograph cannot be used, or null if it can.
 *
 * Each reason names the number, because "invalid image" sends someone back to
 * a camera roll with nothing to look for.
 */
export function photoProblem(size: Dimensions | null): string | null {
  if (!size) {
    return 'That file is not a JPEG or PNG image we can read. Save it as a JPEG and try again.';
  }
  if (size.width < PHOTO_MIN_WIDTH || size.height < PHOTO_MIN_HEIGHT) {
    return `That photograph is ${size.width}×${size.height} pixels. It has to be at least ${PHOTO_MIN_WIDTH}×${PHOTO_MIN_HEIGHT} — smaller than that it cannot be printed on an ID card or a certificate. Take it again closer, or use a larger photograph.`;
  }
  const aspect = size.width / size.height;
  if (Math.abs(aspect - PHOTO_ASPECT) > PHOTO_ASPECT_TOLERANCE) {
    return `That photograph is the wrong shape for a passport photograph (35 by 45). Use the crop tool to square it up before saving.`;
  }
  return null;
}
