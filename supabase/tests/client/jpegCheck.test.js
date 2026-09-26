// src/lib/jpegCheck.js (audit M1): which JPEG files the moderator's browser flags.
// Synthetic files built segment by segment; run.sh bundles this with esbuild and runs it in Node.
// Real browser-made JPEGs are checked in the Playwright pass (canvas.toBlob).
import { checkJpeg, stripJpeg } from '../../../src/lib/jpegCheck.js';

let pass = 0;
let fail = 0;
const check = (name, ok, got) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} jpeg: ${name}${ok ? '' : `  [${JSON.stringify(got)}]`}`);
};

const seg = (marker, payload) => {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
};
const str = (s) => [...s].map((c) => c.charCodeAt(0));
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const APP0 = seg(0xe0, [...str('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const DQT = seg(0xdb, [0, ...new Array(64).fill(1)]);
const SOF = seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]);
const DHT = seg(0xc4, [0, ...new Array(16).fill(0)]);
const SOS = seg(0xda, [1, 1, 0, 0, 63, 0]);
// entropy data with a stuffed 0xFF00 and a restart marker inside
const DATA = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a];
const file = (...parts) => new Uint8Array(parts.flat());
const clean = file(SOI, APP0, DQT, SOF, DHT, SOS, DATA, EOI);

let r = checkJpeg(clean);
check('clean JFIF file (what the browser writes) → ok', r.ok && r.problems.length === 0, r);
r = checkJpeg(file(SOI, APP0, seg(0xe2, str('ICC_PROFILE\0\x01\x01abc')), DQT, SOF, DHT, SOS, DATA, EOI));
check('ICC colour profile (APP2) → ok', r.ok, r);
r = checkJpeg(file(SOI, seg(0xe1, [...str('Exif\0\0'), 0x4d, 0x4d, 0, 42, 0, 0, 0, 8]), DQT, SOF, DHT, SOS, DATA, EOI));
check('EXIF block → exif', !r.ok && r.problems.includes('exif'), r);
r = checkJpeg(file(SOI, APP0, seg(0xe1, str('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>')), DQT, SOF, DHT, SOS, DATA, EOI));
check('XMP block → xmp', !r.ok && r.problems.includes('xmp'), r);
r = checkJpeg(file(SOI, APP0, seg(0xed, str('Photoshop 3.0\0')), DQT, SOF, DHT, SOS, DATA, EOI));
check('IPTC (APP13) → iptc', r.problems.includes('iptc'), r);
r = checkJpeg(file(SOI, APP0, seg(0xfe, str('hello')), DQT, SOF, DHT, SOS, DATA, EOI));
check('comment (COM) → metadata', r.problems.includes('metadata'), r);
r = checkJpeg(file(SOI, APP0, seg(0xeb, str('xx')), DQT, SOF, DHT, SOS, DATA, EOI));
check('other APPn → metadata', r.problems.includes('metadata'), r);
r = checkJpeg(file(SOI, APP0, DQT, SOF, DHT, SOS, DATA, EOI, new Array(200).fill(0x41)));
check('200 bytes after the end → trailing', r.problems.includes('trailing'), r);
r = checkJpeg(file(SOI, APP0, DQT, SOF, DHT, SOS, DATA, EOI, [0, 0, 0, 0]));
check('a few padding bytes after the end → ok', r.ok, r);
r = checkJpeg(file(SOI, APP0, DQT, SOF, DHT, SOS, DATA, EOI, [...clean]));
check('a second JPEG glued on → trailing', r.problems.includes('trailing'), r);
r = checkJpeg(file(SOI, APP0, DQT, SOF, DHT, SOS, DATA, DHT, SOS, DATA, EOI));
check('progressive (two scans) → ok', r.ok, r);
r = checkJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
check('PNG → not_jpeg', r.problems.join() === 'not_jpeg', r);
r = checkJpeg(file(SOI, APP0, DQT, SOF));
check('cut off (no end of image) → broken', r.problems.includes('broken'), r);
r = checkJpeg(new Uint8Array([]));
check('empty → not_jpeg', r.problems.join() === 'not_jpeg', r);

// stripJpeg (our own canvas output only): removes the flagged blocks, keeps the image.
const dirty = file(SOI, APP0, seg(0xe1, [...str('Exif\0\0'), 1, 2, 3]), seg(0xfe, str('hi')), DQT, SOF, DHT, SOS, DATA, EOI, new Array(100).fill(7));
const stripped = stripJpeg(dirty);
check('strip: EXIF + comment + trailing removed → clean', stripped && checkJpeg(stripped).ok, stripped && checkJpeg(stripped));
check('strip: the result is exactly the clean file', stripped && Buffer.from(stripped).equals(Buffer.from(clean)), stripped?.length);
check('strip: a clean file stays byte-identical', Buffer.from(stripJpeg(clean)).equals(Buffer.from(clean)));
check('strip: not a JPEG → null', stripJpeg(new Uint8Array([1, 2, 3, 4])) === null);

console.log(`jpegCheck (client): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
