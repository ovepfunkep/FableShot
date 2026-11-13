import { Capacitor, registerPlugin } from '@capacitor/core';
import { exchangeBrowserRoom } from './browser-room-probe.ts';
import type { GroupSeriesRevision, GroupSeriesTransport } from './group-series.ts';

type RoomCapabilities = { cg3?: boolean; pg1?: boolean };
export type RoomStatus = RoomCapabilities & { invitation?: string; checks?: number; acceptedSeries?: number; roomName?: string; restorable?: boolean };
export type RoomMembership = RoomCapabilities & { roomId: string; entryId: string; invitation: string; publicKey: string; privateKey: string; displayName?: string; roomName?: string };

export const roomBridge = registerPlugin<{
  addresses(): Promise<{ addresses: string[] }>;
  start(options: { address: string; roomName?: string }): Promise<RoomStatus>;
  status(): Promise<RoomStatus>;
  check(options: { invitation: string }): Promise<{ milliseconds: number }>;
  stop(): Promise<void>;
  publish(options: { invitation: string; payload: string; publicKey: string; signature: string }): Promise<unknown>;
  snapshot(options: { invitation: string }): Promise<unknown>;
}>('LocalRoomProbe');

export function supportsLocalRoom() {
  return Capacitor.isPluginAvailable('LocalRoomProbe') ||
    ['https://ovepfunkep.github.io', 'http://localhost:4173'].includes(window.location.origin);
}

const encode = (buffer: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
const storageKey = 'app.fableshot.room-membership.v1';

function derSignature(raw: ArrayBuffer) {
  function integer(bytes: Uint8Array) {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const value = bytes.subarray(start);
    return value[0] & 0x80 ? [2, value.length + 1, 0, ...value] : [2, value.length, ...value];
  }
  const values = [...integer(new Uint8Array(raw, 0, 32)), ...integer(new Uint8Array(raw, 32, 32))];
  return Uint8Array.of(0x30, values.length, ...values);
}

export async function createRoomMembership(invitation: string, name = '', roomName?: string, capabilities: RoomCapabilities = {}): Promise<RoomMembership> {
  const fields = /^FS1:[\d.]+:\d+:([\w-]{32})$/.exec(invitation);
  if (!fields) throw new Error('Нужен код приглашения из комнаты FableShot.');
  const secret = decode(fields[1].replace(/-/g, '+').replace(/_/g, '/'));
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const [room, publicKey, privateKey] = await Promise.all([
    crypto.subtle.digest('SHA-256', secret),
    crypto.subtle.exportKey('spki', pair.publicKey),
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
  ]);
  return { roomId: hex(room), entryId: hex(await crypto.subtle.digest('SHA-256', publicKey)), invitation,
    publicKey: encode(publicKey), privateKey: encode(privateKey), displayName: name.trim().slice(0, 60) || undefined, roomName,
    cg3: capabilities.cg3, pg1: capabilities.pg1 };
}

export function saveRoomMembership(value: RoomMembership) {
  localStorage.setItem(`${storageKey}.${value.entryId}`, JSON.stringify(value));
}

export function loadRoomMembership(entryId: string): RoomMembership | null {
  return JSON.parse(localStorage.getItem(`${storageKey}.${entryId}`) ?? 'null') as RoomMembership | null;
}

export function roomSnapshot(invitation: string) {
  return Capacitor.isPluginAvailable('LocalRoomProbe') ? roomBridge.snapshot({ invitation }) : exchangeBrowserRoom(invitation, { action: 'snapshot' });
}

export function readRoomName(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== 'object' || !('roomName' in snapshot)) return undefined;
  return typeof snapshot.roomName === 'string' && snapshot.roomName.length <= 60 ? snapshot.roomName.trim() || undefined : undefined;
}

async function signedRoomRequest(value: RoomMembership, operation: object) {
  const payload = JSON.stringify({ roomId: value.roomId, entryId: value.entryId, ...operation });
  const key = await crypto.subtle.importKey('pkcs8', decode(value.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payload));
  const request = { payload, publicKey: value.publicKey, signature: encode(derSignature(signature)) };
  return Capacitor.isPluginAvailable('LocalRoomProbe')
    ? roomBridge.publish({ invitation: value.invitation, ...request }) : exchangeBrowserRoom(value.invitation, request);
}

export async function announceRoomEntry(value: RoomMembership, bowCategory: string | null) {
  const receipt = await signedRoomRequest(value, { action: 'join', displayName: value.displayName, bowCategory });
  if (!receipt || typeof receipt !== 'object' || !('joined' in receipt) || receipt.joined !== value.entryId) {
    throw new Error('Комната не подтвердила вход.');
  }
}

export function roomTransport(entryId: string): GroupSeriesTransport {
  return { async publish(roomId: string, id: string, operation: GroupSeriesRevision) {
    const value = loadRoomMembership(entryId);
    if (!value || value.roomId !== roomId || value.entryId !== id) throw new Error('Приглашение в комнату недоступно.');
    const result = operation.result;
    return signedRoomRequest(value, { ...operation, result: result && { ...result, spread: value.cg3 ? result.spread : undefined,
      progressBase: value.pg1 ? result.progressBase : undefined },
      ...(value.roomName && value.displayName ? { displayName: value.displayName } : {}) });
  } };
}
