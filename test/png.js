// Minimal PNG decoder for tests (8-bit RGB/RGBA, non-interlaced) — enough for Terrarium tiles.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  let off = 8, w, h, ch;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      ch = { 2: 3, 6: 4 }[data[9]];
      if (!ch) throw new Error(`unsupported color type ${data[9]}`);
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < ch ? cur[x * ch + k] : 255;
    [prev, cur] = [cur, prev];
  }
  return out;
}
