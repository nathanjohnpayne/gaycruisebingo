'use strict';

const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function boundedString(value, label, max, min = 0) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new Error(`${label} must be ${min}-${max} characters.`);
  return trimmed;
}

function validateClientReportFields(input) {
  if (!input || typeof input !== 'object') throw new Error('Report payload is required.');
  if (input.schemaVersion !== 1) throw new Error('Unsupported report schema.');
  if (!input.viewport || typeof input.viewport !== 'object') throw new Error('Viewport is required.');
  const width = input.viewport.width;
  const height = input.viewport.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 200 || width > 10000 || height < 200 || height > 10000) {
    throw new Error('Viewport dimensions are invalid.');
  }
  if (typeof input.online !== 'boolean') throw new Error('Online state is required.');
  const route = boundedString(input.route, 'Route', 200, 1);
  if (!route.startsWith('/')) throw new Error('Route must be app-relative.');
  const eventId = boundedString(input.eventId, 'Event ID', 100, 1);
  if (!/^[A-Za-z0-9_-]+$/.test(eventId)) throw new Error('Event ID is invalid.');
  return {
    schemaVersion: 1,
    description: boundedString(input.description, 'Description', 4000, 1),
    captureError: input.captureError == null ? null : boundedString(input.captureError, 'Capture error', 200),
    route,
    eventId,
    appVersion: boundedString(input.appVersion, 'App version', 100, 1),
    browser: boundedString(input.browser, 'Browser', 500, 1),
    viewport: { width, height },
    online: input.online,
  };
}

function validatePngBytes(value) {
  if (!Buffer.isBuffer(value) || value.length > SCREENSHOT_MAX_BYTES || value.length < 45 || !value.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Screenshot is not a valid PNG within the 5 MiB limit.');
  }
  let offset = 8;
  let chunks = 0;
  let sawIdat = false;
  let ended = false;
  while (offset + 12 <= value.length) {
    const length = value.readUInt32BE(offset);
    const dataEnd = offset + 12 + length;
    if (length > SCREENSHOT_MAX_BYTES || dataEnd > value.length) throw new Error('Screenshot PNG is truncated.');
    const type = value.toString('ascii', offset + 4, offset + 8);
    const crcInput = value.subarray(offset + 4, offset + 8 + length);
    if (crc32(crcInput) !== value.readUInt32BE(offset + 8 + length)) throw new Error('Screenshot PNG checksum is invalid.');
    if (chunks === 0) {
      const width = value.readUInt32BE(offset + 8);
      const height = value.readUInt32BE(offset + 12);
      const bitDepth = value[offset + 16];
      const colorType = value[offset + 17];
      const legalDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (type !== 'IHDR' || length !== 13 || width === 0 || height === 0 || width > 8192 || height > 8192 || width * height > 40_000_000 ||
          !legalDepths[colorType]?.includes(bitDepth) || value[offset + 18] !== 0 || value[offset + 19] !== 0 || ![0, 1].includes(value[offset + 20])) {
        throw new Error('Screenshot PNG header is invalid.');
      }
    }
    if (type === 'IDAT') sawIdat = true;
    chunks += 1;
    offset = dataEnd;
    if (type === 'IEND') {
      if (length !== 0 || offset !== value.length) throw new Error('Screenshot PNG ending is invalid.');
      ended = true;
      break;
    }
  }
  if (!ended || !sawIdat) throw new Error('Screenshot PNG is incomplete.');
  return value;
}

module.exports = { SCREENSHOT_MAX_BYTES, validateClientReportFields, validatePngBytes };
