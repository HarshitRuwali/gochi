// image.ts — convert a PNG/JPG file to the 128x64 1bpp frame the device
// expects, returned as a base64 string ready for `SHOW image`.
//
// Pipeline:
//   1. sharp → grayscale + resize to 128x64 (no upscale guard; sharp
//      handles both up- and downsampling. `fit: "contain"` letterboxes
//      with a black background to preserve the aspect ratio).
//   2. Convert to 1-bit either by Floyd–Steinberg dither (default; best
//      for photos) or a plain brightness threshold (good for line art).
//   3. Pack the bit grid MSB-first into 1024 bytes (16 cols × 64 rows).
//   4. Base64-encode.

import sharp from "sharp";

export const FRAME_WIDTH = 128;
export const FRAME_HEIGHT = 64;
export const FRAME_BYTES = (FRAME_WIDTH / 8) * FRAME_HEIGHT;  // 1024

export type ConvertOptions = {
  // 0..255 cutoff for plain-threshold mode. Default 128. Ignored under
  // dither.
  threshold?: number;
  // When false, skip Floyd–Steinberg and just threshold pixel-by-pixel.
  dither?: boolean;
  // Invert the result (white becomes off, black becomes on).
  invert?: boolean;
  // Background fill for letterboxed area when the source isn't 2:1.
  // Defaults to black so the OLED stays mostly off.
  background?: "black" | "white";
};

// Convert one image file to a frame and return base64. Throws on
// unreadable / undecodable files.
export async function fileToFrameBase64(
  path: string,
  opts: ConvertOptions = {},
): Promise<string> {
  const bytes = await fileToFrameBytes(path, opts);
  return Buffer.from(bytes).toString("base64");
}

// Same as above but returns the raw 1024-byte packed bitmap.
export async function fileToFrameBytes(
  path: string,
  opts: ConvertOptions = {},
): Promise<Uint8Array> {
  const dither = opts.dither !== false;  // default true
  const threshold = opts.threshold ?? 128;
  const background = opts.background ?? "black";
  const bg = background === "white"
    ? { r: 255, g: 255, b: 255, alpha: 1 }
    : { r: 0, g: 0, b: 0, alpha: 1 };

  // grayscale → letterboxed 128x64 → raw 8-bit pixels.
  const { data, info } = await sharp(path)
    .grayscale()
    .resize(FRAME_WIDTH, FRAME_HEIGHT, { fit: "contain", background: bg })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== FRAME_WIDTH || info.height !== FRAME_HEIGHT) {
    // Should never happen with `fit: contain`, but guard anyway.
    throw new Error(`unexpected resize result: ${info.width}x${info.height}`);
  }

  // Work in Int16 so the error term can be negative or >255.
  const lum = new Int16Array(FRAME_WIDTH * FRAME_HEIGHT);
  for (let i = 0; i < lum.length; i++) lum[i] = data[i];

  const bits = dither
    ? floydSteinberg(lum, FRAME_WIDTH, FRAME_HEIGHT)
    : threshold1bpp(lum, threshold);

  if (opts.invert) {
    for (let i = 0; i < bits.length; i++) bits[i] ^= 1;
  }

  return packMsbFirst(bits, FRAME_WIDTH, FRAME_HEIGHT);
}

// Floyd–Steinberg error diffusion. Returns a Uint8Array of 0/1 bits, one
// entry per pixel, row-major.
function floydSteinberg(lum: Int16Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = lum[i];
      const next = old < 128 ? 0 : 255;
      out[i] = next === 255 ? 1 : 0;
      const err = old - next;
      if (x + 1 < w) lum[i + 1] += (err * 7) >> 4;
      if (y + 1 < h) {
        if (x > 0) lum[i + w - 1] += (err * 3) >> 4;
        lum[i + w] += (err * 5) >> 4;
        if (x + 1 < w) lum[i + w + 1] += (err * 1) >> 4;
      }
    }
  }
  return out;
}

// Hard threshold — every pixel < `t` becomes 0, others 1.
function threshold1bpp(lum: Int16Array, t: number): Uint8Array {
  const out = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) out[i] = lum[i] >= t ? 1 : 0;
  return out;
}

// Pack a row-major bit grid into MSB-first bytes (bit 7 = leftmost pixel).
// This matches what U8g2's drawBitmap() expects on the firmware side.
function packMsbFirst(bits: Uint8Array, w: number, h: number): Uint8Array {
  const bytesPerRow = w >> 3;
  const out = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let xb = 0; xb < bytesPerRow; xb++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (bits[y * w + xb * 8 + bit] === 1) byte |= 1 << (7 - bit);
      }
      out[y * bytesPerRow + xb] = byte;
    }
  }
  return out;
}
