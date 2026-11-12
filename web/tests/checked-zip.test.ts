import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync } from 'fflate';
import { checkedUnzip } from '../src/checked-zip.ts';
import type { CheckedZipOptions } from '../src/checked-zip.ts';
import { readMyTargetsZip } from '../src/mytargets-zip.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const options: CheckedZipOptions = {
  maxInputBytes: 1024 * 1024, maxExpandedBytes: 1024 * 1024, maxEntries: 2,
  allowedName: name => name === 'manifest.json' || name === 'data/web/records.json',
};
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function headers(bytes: Uint8Array): { central: number[]; eocd: number } {
  const data = view(bytes), eocd = bytes.length - 22, central: number[] = [];
  let at = data.getUint32(eocd + 16, true);
  for (let index = 0; index < data.getUint16(eocd + 10, true); index++) {
    central.push(at);
    at += 46 + data.getUint16(at + 28, true) + data.getUint16(at + 30, true) + data.getUint16(at + 32, true);
  }
  return { central, eocd };
}
function archive(level: 0 | 6 = 6): Uint8Array {
  return zipSync({ 'manifest.json': encode('{"version":1}'), 'data/web/records.json': encode('{"records":[]}') }, { level });
}
function withDescriptor(signed: boolean, name = 'manifest.json'): Uint8Array {
  const original = zipSync({ [name]: encode('Java streaming data '.repeat(100)) });
  const data = view(original), { central: [central], eocd } = headers(original);
  const added = signed ? 16 : 12, bytes = new Uint8Array(original.length + added);
  bytes.set(original.subarray(0, central)); bytes.set(original.subarray(central), central + added);
  const target = view(bytes), descriptor = central + (signed ? 4 : 0);
  if (signed) target.setUint32(central, 0x08074b50, true);
  for (let index = 0; index < 3; index++) {
    target.setUint32(descriptor + index * 4, data.getUint32(central + 16 + index * 4, true), true);
    target.setUint32(14 + index * 4, 0, true);
  }
  target.setUint16(6, 8, true); target.setUint16(central + added + 8, 8, true);
  target.setUint32(eocd + added + 16, central + added, true);
  return bytes;
}

test('checked ZIP reads stored and deflated own archives, including byte-offset inputs', () => {
  for (const level of [0, 6] as const) {
    const bytes = archive(level), padded = new Uint8Array(bytes.length + 5);
    padded.set(bytes, 3);
    const files = checkedUnzip(padded.subarray(3, 3 + bytes.length), options);
    assert.equal(new TextDecoder().decode(files['manifest.json']), '{"version":1}');
    assert.equal(new TextDecoder().decode(files['data/web/records.json']), '{"records":[]}');
    assert.equal(Object.keys(files).length, 2);
  }
});

test('checked ZIP accepts signed and unsigned Java-style data descriptors and checks their values', () => {
  for (const signed of [false, true]) {
    const bytes = withDescriptor(signed);
    assert.equal(checkedUnzip(bytes, options)['manifest.json'].length, 2000);
    const { central: [central] } = headers(bytes);
    bytes[central - 1] ^= 1;
    assert.throws(() => checkedUnzip(bytes, options), /archive_corrupt/);
  }
});

test('stored compressed bytes cannot bypass the expanded-size cap with a false zero size', () => {
  const bytes = archive(0), data = view(bytes), { central: [central] } = headers(bytes);
  data.setUint32(22, 0, true); data.setUint32(central + 24, 0, true);
  assert.throws(() => checkedUnzip(bytes, options), /archive_corrupt/);
});

test('deflate cannot silently truncate a forged size even when CRC matches the truncated prefix', () => {
  const bytes = zipSync({ 'manifest.json': encode('x'.repeat(10000)) }), data = view(bytes);
  const { central: [central] } = headers(bytes);
  // The CRC of an empty payload is zero. fflate unzipSync accepts this truncation.
  data.setUint32(14, 0, true); data.setUint32(22, 0, true);
  data.setUint32(central + 16, 0, true); data.setUint32(central + 24, 0, true);
  assert.throws(() => checkedUnzip(bytes, options), /archive_corrupt/);
});

test('overlapping local records are rejected even when every individual header and size is valid', () => {
  const nested = zipSync({ 'data/web/records.json': encode('records') }, { level: 0 });
  const nestedLocal = nested.subarray(0, headers(nested).central[0]);
  const bytes = zipSync({ 'manifest.json': nestedLocal, 'data/web/records.json': encode('records') }, { level: 0 });
  const data = view(bytes), { central: [, second] } = headers(bytes);
  const firstData = 30 + data.getUint16(26, true) + data.getUint16(28, true);
  data.setUint32(second + 42, firstData, true);
  assert.throws(() => checkedUnzip(bytes, options), /archive_corrupt/);
});

test('reused local offsets and local versus central name mismatches are rejected', () => {
  const bytes = archive(), data = view(bytes), { central: [first, second] } = headers(bytes);
  data.setUint32(second + 42, data.getUint32(first + 42, true), true);
  assert.throws(() => checkedUnzip(bytes, options), /archive_corrupt/);
  const mismatch = archive(); mismatch[30] ^= 1;
  assert.throws(() => checkedUnzip(mismatch, options), /archive_corrupt/);
});

test('names must be allowed, safe, and unique without case distinctions', () => {
  const permissive = { ...options, allowedName: () => true };
  assert.throws(() => checkedUnzip(zipSync({ unknown: encode('x') }), options), /archive_unsupported_entry/);
  for (const name of ['/manifest.json', '../manifest.json', 'a//b', 'a/./b', 'a\\b', 'C:file', 'a\u0000b']) {
    assert.throws(() => checkedUnzip(zipSync({ [name]: encode('x') }), permissive), /archive_unsafe_path/, name);
  }
  assert.throws(() => checkedUnzip(zipSync({ 'manifest.json': encode('a'), 'MANIFEST.JSON': encode('b') }), permissive), /archive_duplicate_entry/);
  assert.throws(() => checkedUnzip(zipSync({ '\ufeffmanifest.json': encode('x') }), options), /archive_unsupported_entry/);
  const utf8 = checkedUnzip(zipSync({ 'данные.json': encode('ok') }), permissive);
  assert.equal(new TextDecoder().decode(utf8['данные.json']), 'ok');
});

test('input, declared expansion and entry counts are capped before payload decompression', () => {
  const bytes = archive();
  assert.throws(() => checkedUnzip(bytes, { ...options, maxInputBytes: bytes.length - 1 }), /file_too_large/);
  assert.throws(() => checkedUnzip(bytes, { ...options, maxEntries: 1 }), /archive_too_many_entries/);
  assert.throws(() => checkedUnzip(bytes, { ...options, maxExpandedBytes: 20 }), /archive_too_large/);
  const data = view(bytes), { central: [central] } = headers(bytes);
  data.setUint32(central + 24, 0xfffffffe, true);
  assert.throws(() => checkedUnzip(bytes, options), /archive_too_large/);
});

test('CRC, encryption, unsupported compression, multidisk and ZIP64 metadata are rejected', () => {
  const damaged = archive(0), damagedData = view(damaged);
  damaged[30 + damagedData.getUint16(26, true) + damagedData.getUint16(28, true)] ^= 1;
  assert.throws(() => checkedUnzip(damaged, options), /archive_corrupt/);
  for (const mutate of [
    (bytes: Uint8Array) => view(bytes).setUint16(headers(bytes).central[0] + 8, 1, true),
    (bytes: Uint8Array) => view(bytes).setUint16(headers(bytes).central[0] + 10, 99, true),
    (bytes: Uint8Array) => view(bytes).setUint16(headers(bytes).central[0] + 34, 1, true),
    (bytes: Uint8Array) => view(bytes).setUint32(headers(bytes).central[0] + 24, 0xffffffff, true),
    (bytes: Uint8Array) => view(bytes).setUint16(headers(bytes).eocd + 4, 1, true),
  ]) {
    const bytes = archive(); mutate(bytes);
    assert.throws(() => checkedUnzip(bytes, options), /archive_(unsupported_entry|corrupt)/);
  }
  const zip64Extra = zipSync({ 'manifest.json': [encode('x'), { extra: { 1: new Uint8Array(8) } }] });
  assert.throws(() => checkedUnzip(zip64Extra, options), /archive_unsupported_entry/);
});

test('truncation, incomplete central metadata and invalid configured limits are rejected', () => {
  const bytes = archive();
  for (const length of [0, 1, 21, bytes.length - 1]) assert.throws(() => checkedUnzip(bytes.subarray(0, length), options), /archive_corrupt/);
  const forged = bytes.slice(), data = view(forged), { eocd } = headers(forged);
  data.setUint32(eocd + 12, 0, true);
  assert.throws(() => checkedUnzip(forged, options), /archive_corrupt/);
  assert.throws(() => checkedUnzip(bytes, { ...options, maxExpandedBytes: -1 }), /archive_invalid_limits/);
});

test('legacy slash support normalizes exactly once and rejects normalized aliases', () => {
  const legacy = { ...options, allowLeadingSlash: true };
  assert.deepEqual(Object.keys(checkedUnzip(zipSync({ '/manifest.json': encode('x') }), legacy)), ['manifest.json']);
  assert.throws(() => checkedUnzip(zipSync({ '//manifest.json': encode('x') }), legacy), /archive_unsafe_path/);
  assert.throws(() => checkedUnzip(zipSync({ 'manifest.json': encode('a'), '/manifest.json': encode('b') }), legacy), /archive_duplicate_entry/);
  assert.throws(() => checkedUnzip(zipSync({ '/manifest.json': encode('x') }), options), /archive_unsafe_path/);
});

test('MyTargets keeps leading-slash compatibility, attachments and streaming descriptor support', () => {
  const result = readMyTargetsZip(zipSync({ '/data.db': encode('database'), '/image.JPG': encode('image'), 'other.png': encode('image') }));
  assert.equal(new TextDecoder().decode(result.database), 'database');
  assert.equal(result.ignoredAttachments, 2);
  assert.equal(readMyTargetsZip(withDescriptor(true, '/data.db')).database.length, 2000);
});

test('MyTargets refuses aliases, repeated slashes, unknown attachments and declared oversized databases', () => {
  for (const files of [
    { '/data.db': encode('a'), 'data.db': encode('b') },
    { '/data.db': encode('a'), '/IMAGE.JPG': encode('a'), '/image.jpg': encode('b') },
    { '//data.db': encode('a') },
    { '/data.db': encode('a'), '/extra.txt': encode('a') },
  ]) assert.throws(() => readMyTargetsZip(zipSync(files)));
  const large = zipSync({ '/data.db': encode('x') }), data = view(large), { central: [central] } = headers(large);
  data.setUint32(central + 24, 26 * 1024 * 1024, true);
  assert.throws(() => readMyTargetsZip(large), /archive_too_large/);
  assert.throws(() => readMyTargetsZip(zipSync({ '/image.jpg': encode('x') })), /archive_database_missing/);
});

test('MyTargets refuses false stored sizes and forged deflate truncation', () => {
  for (const level of [0, 6] as const) {
    const bytes = zipSync({ '/data.db': encode('x'.repeat(10000)) }, { level });
    const data = view(bytes), { central: [central] } = headers(bytes);
    data.setUint32(14, 0, true); data.setUint32(22, 0, true);
    data.setUint32(central + 16, 0, true); data.setUint32(central + 24, 0, true);
    assert.throws(() => readMyTargetsZip(bytes), /archive_corrupt/);
  }
});
