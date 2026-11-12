import { inflateSync } from 'fflate';

export type CheckedZipOptions = {
  maxInputBytes: number;
  maxExpandedBytes: number;
  maxEntries: number;
  allowedName(name: string): boolean;
  /** Legacy MyTargets archives prefix root files with one slash. */
  allowLeadingSlash?: boolean;
  maxEntryBytes?(name: string): number;
};

const bad = (code = 'archive_corrupt'): never => { throw new Error(code); };
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Validate every ZIP entry before allocating or decompressing any payload. */
export function checkedUnzip(bytes: Uint8Array, options: CheckedZipOptions): Record<string, Uint8Array> {
  if (![options.maxInputBytes, options.maxExpandedBytes, options.maxEntries].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('archive_invalid_limits');
  }
  if (bytes.length > options.maxInputBytes) bad('file_too_large');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (start: number, length: number, limit = bytes.length) => {
    if (start < 0 || length < 0 || start + length > limit) bad();
  };
  const u16 = (at: number) => { range(at, 2); return view.getUint16(at, true); };
  const u32 = (at: number) => { range(at, 4); return view.getUint32(at, true); };
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { eocd = at; break; }
  }
  if (eocd < 0 || u16(eocd + 4) || u16(eocd + 6) || u16(eocd + 8) !== u16(eocd + 10)) bad();
  const count = u16(eocd + 10), centralSize = u32(eocd + 12), centralStart = u32(eocd + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) bad('archive_unsupported_entry');
  if (count > options.maxEntries) bad('archive_too_many_entries');
  if (centralStart + centralSize !== eocd) bad();
  const extra = (start: number, length: number, limit: number) => {
    range(start, length, limit);
    const end = start + length;
    while (start < end) {
      range(start, 4, end);
      const kind = u16(start), size = u16(start + 2);
      if (kind === 1) bad('archive_unsupported_entry'); // ZIP64 changes the meaning of size/offset fields.
      start += 4;
      range(start, size, end);
      start += size;
    }
  };
  const entries: { name: string; size: number; crc: number; method: number; start: number; end: number }[] = [];
  const names = new Set<string>(), ranges: [number, number][] = [];
  let at = centralStart, expanded = 0;
  for (let index = 0; index < count; index++) {
    range(at, 46, eocd);
    if (u32(at) !== 0x02014b50) bad();
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16);
    const compressed = u32(at + 20), size = u32(at + 24), nameLength = u16(at + 28);
    const extraLength = u16(at + 30), commentLength = u16(at + 32), local = u32(at + 42);
    if (u16(at + 6) > 20 || flags & ~0x080e || ![0, 8].includes(method) || u16(at + 34) ||
      compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) bad('archive_unsupported_entry');
    range(at + 46, nameLength + extraLength + commentLength, eocd);
    if (!nameLength || nameLength > 240) bad('archive_unsafe_path');
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
    if (!(flags & 0x800) && rawName.some(byte => byte > 127)) bad('archive_unsafe_path');
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawName); } catch { return bad('archive_unsafe_path'); }
    if (options.allowLeadingSlash && name.startsWith('/')) name = name.slice(1);
    if (/[\\:\x00-\x1f\x7f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) bad('archive_unsafe_path');
    if (names.has(name.toLowerCase())) bad('archive_duplicate_entry');
    names.add(name.toLowerCase());
    if (!options.allowedName(name)) bad('archive_unsupported_entry');
    const entryLimit = options.maxEntryBytes?.(name) ?? options.maxExpandedBytes;
    if (!Number.isSafeInteger(entryLimit) || entryLimit < 0) bad('archive_invalid_limits');
    if (size > entryLimit || size > options.maxExpandedBytes - expanded) bad('archive_too_large');
    expanded += size;
    if (method === 0 && compressed !== size) bad();
    extra(at + 46 + nameLength, extraLength, eocd);

    range(local, 30, centralStart);
    if (u32(local) !== 0x04034b50 || u16(local + 4) > 20 || u16(local + 6) !== flags ||
      u16(local + 8) !== method || u16(local + 26) !== nameLength) bad();
    const localExtraLength = u16(local + 28), start = local + 30 + nameLength + localExtraLength;
    range(local + 30, nameLength + localExtraLength, centralStart);
    if (rawName.some((byte, offset) => bytes[local + 30 + offset] !== byte)) bad();
    extra(local + 30 + nameLength, localExtraLength, centralStart);
    const end = start + compressed;
    range(start, compressed, centralStart);
    let rangeEnd = end;
    if (flags & 8) {
      const localZero = !u32(local + 14) && !u32(local + 18) && !u32(local + 22);
      if (!localZero && (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size)) bad();
      // Java writes signed descriptors; other producers omit the optional signature.
      const descriptorMatches = (position: number) => position + 12 <= centralStart &&
        u32(position) === crc && u32(position + 4) === compressed && u32(position + 8) === size;
      if (end + 16 <= centralStart && u32(end) === 0x08074b50 && descriptorMatches(end + 4)) rangeEnd += 16;
      else if (descriptorMatches(end)) rangeEnd += 12;
      else bad();
    } else if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size) bad();
    ranges.push([local, rangeEnd]);
    entries.push({ name, size, crc, method, start, end });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== eocd) bad();
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((entry, index) => index > 0 && ranges[index - 1][1] > entry[0])) bad();

  const contents: Record<string, Uint8Array> = Object.create(null);
  for (const entry of entries) {
    let data: Uint8Array;
    try {
      const compressed = bytes.subarray(entry.start, entry.end);
      // fflate truncates into a supplied output buffer. The extra byte makes any overflow observable.
      data = entry.method === 0 ? compressed.slice() : inflateSync(compressed, { out: new Uint8Array(entry.size + 1) });
    } catch { return bad(); }
    if (data.length !== entry.size || crc32(data) !== entry.crc) bad();
    contents[entry.name] = data;
  }
  return contents;
}
