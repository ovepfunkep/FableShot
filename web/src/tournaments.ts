import { BOW_CATEGORIES } from './equipment.ts';
import { isLocalDate } from './import-source.ts';
import type { Diary } from './persistence.ts';

export const tournamentStatuses = { participated: 'Участвовал', planned: 'Планирую', absent: 'Не стартовал' } as const;
export type TournamentStatus = keyof typeof tournamentStatuses;
type BowCategory = typeof BOW_CATEGORIES[number]['value'];
export type TournamentStart = {
  id: string; category: string; bow: BowCategory | null; status: TournamentStatus;
  result: string; place: number | null; participants: number | null; sessionIds: string[];
};
export type Tournament = {
  id: string; title: string; from: string; to: string | null; venue: string;
  protocol: string; note: string; starts: TournamentStart[];
  attachments?: TournamentAttachment[];
  completed?: true;
};
export type TournamentAttachment = { id: string; name: string; type: 'application/pdf' | 'image/png' | 'image/jpeg'; data: string };
export type TournamentChoice = { tournamentId: string; startId: string };
export const MAX_PROTOCOL_FILE = 384 * 1024;
const MAX_PROTOCOL_TOTAL = 768 * 1024;

const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;
const id = (value: unknown): value is string => text(value, 512) && value.trim().length > 0;
const place = (value: unknown) => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const bows = new Set(BOW_CATEGORIES.map(category => category.value));
const attachmentType = (value: unknown): value is TournamentAttachment['type'] =>
  value === 'application/pdf' || value === 'image/png' || value === 'image/jpeg';

function attachmentBytes(value: TournamentAttachment) {
  return value.data.length / 4 * 3 - (value.data.endsWith('==') ? 2 : value.data.endsWith('=') ? 1 : 0);
}

function signatureMatches(type: TournamentAttachment['type'], head: string) {
  return type === 'application/pdf' ? head.startsWith('%PDF-') : type === 'image/png' ? head.startsWith('\x89PNG\r\n\x1a\n') : head.startsWith('\xff\xd8\xff');
}

function validAttachments(value: unknown): value is TournamentAttachment[] {
  if (!Array.isArray(value) || value.length > 3) return false;
  const ids = new Set<string>();
  for (const file of value as TournamentAttachment[]) {
    if (!file || !id(file.id) || ids.has(file.id) || !text(file.name, 160) || !file.name.trim() ||
        !attachmentType(file.type) || !text(file.data, Math.ceil(MAX_PROTOCOL_FILE / 3) * 4) ||
        file.data.length < 12 || file.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data) ||
        attachmentBytes(file) > MAX_PROTOCOL_FILE || !signatureMatches(file.type, atob(file.data.slice(0, 12)))) return false;
    ids.add(file.id);
  }
  return true;
}

export async function readTournamentAttachment(file: File): Promise<TournamentAttachment> {
  if (!attachmentType(file.type)) throw new Error('Выбери PDF, JPG или PNG.');
  let content: Blob = file;
  let name = file.name;
  let type = file.type;
  if (file.size > MAX_PROTOCOL_FILE && file.type !== 'application/pdf' && file.size <= 15 * 1024 * 1024) {
    const image = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Не удалось обработать фото протокола.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      content = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) :
        reject(new Error('Не удалось уменьшить фото протокола.')), 'image/jpeg', .73));
      type = 'image/jpeg';
      name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    } finally { image.close(); }
  }
  if (content.size > MAX_PROTOCOL_FILE) throw new Error('Файл должен быть не больше 384 КБ. Можно сохранить ссылку на протокол.');
  const bytes = new Uint8Array(await content.arrayBuffer());
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  const attachment = { id: crypto.randomUUID(), name: name.slice(0, 160), type, data: btoa(parts.join('')) };
  if (!validAttachments([attachment])) throw new Error('Содержимое файла не соответствует выбранному формату.');
  return attachment;
}
export const emptyTournamentStart = (): TournamentStart => ({
  id: crypto.randomUUID(), category: '', bow: null, status: 'participated',
  result: '', place: null, participants: null, sessionIds: [],
});

function validProtocol(value: unknown) {
  if (!text(value, 2000)) return false;
  if (!value) return true;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function isTournament(value: unknown): value is Tournament {
  if (!value || typeof value !== 'object') return false;
  const item = value as Tournament;
  if (!id(item.id) || !text(item.title, 160) || !isLocalDate(item.from) ||
      item.to !== null && (!isLocalDate(item.to) || item.to < item.from) ||
      !text(item.venue, 160) || !text(item.note, 4000) || !validProtocol(item.protocol) ||
      item.completed !== undefined && item.completed !== true ||
      item.attachments !== undefined && !validAttachments(item.attachments) ||
      !Array.isArray(item.starts) || item.starts.length < 1 || item.starts.length > 40) return false;
  const startIds = new Set<string>();
  for (const start of item.starts) {
    if (!start || !id(start.id) || startIds.has(start.id) || !text(start.category, 120) ||
        start.bow !== null && !bows.has(start.bow) || typeof start.status !== 'string' || !Object.hasOwn(tournamentStatuses, start.status) ||
        !text(start.result, 240) || !place(start.place) || !place(start.participants) ||
        start.place !== null && start.participants !== null && start.place > start.participants ||
        start.status !== 'participated' && (start.place !== null || start.result.length > 0) ||
        !Array.isArray(start.sessionIds) || !Array.from(start.sessionIds).every(id)) return false;
    startIds.add(start.id);
  }
  return true;
}

export function isTournamentList(value: unknown, sessions: ReadonlySet<string>): value is Tournament[] {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  const ids = new Set<string>(), linked = new Set<string>();
  let protocolBytes = 0;
  for (const tournament of value) {
    if (!isTournament(tournament) || ids.has(tournament.id)) return false;
    ids.add(tournament.id);
    protocolBytes += (tournament.attachments ?? []).reduce((sum, file) => sum + attachmentBytes(file), 0);
    if (protocolBytes > MAX_PROTOCOL_TOTAL) return false;
    for (const start of tournament.starts) for (const session of start.sessionIds) {
      if (linked.has(session) || !sessions.has(session)) return false;
      linked.add(session);
    }
  }
  return true;
}

export const tournamentTitle = (item: Tournament) => item.title || `Турнир · ${item.from.split('-').reverse().join('.')}`;

export function tournamentLinks(tournaments: readonly Tournament[]) {
  return new Map(tournaments.flatMap(tournament => tournament.starts.flatMap(start => start.sessionIds.map(id => [id, { tournament, start }] as const))));
}

export function saveTournament(diary: Diary, item: Tournament): Diary {
  if (!isTournament(item)) throw new Error('Проверь данные турнира.');
  const tournaments = [...(diary.tournaments ?? []).filter(existing => existing.id !== item.id), item];
  if (tournaments.flatMap(event => event.attachments ?? []).reduce((sum, file) => sum + attachmentBytes(file), 0) > MAX_PROTOCOL_TOTAL) {
    throw new Error('Во всех турнирах можно хранить до 768 КБ вложений. Удали ненужный файл или сохрани ссылку на протокол.');
  }
  if (!isTournamentList(tournaments, new Set(diary.entries.map(entry => entry.id)))) {
    throw new Error('Проверь даты, место, ссылку и связанные тренировки. Каждая тренировка относится к одному старту.');
  }
  return { ...diary, tournaments };
}

export function linkTournamentSession(diary: Diary, choice: TournamentChoice, id: string): Diary {
  const item = diary.tournaments?.find(tournament => tournament.id === choice.tournamentId && !tournament.completed);
  const start = item?.starts.find(candidate => candidate.id === choice.startId && candidate.status !== 'absent');
  if (!item || !start) throw new Error('Этот турнирный старт больше недоступен.');
  return saveTournament(diary, { ...item, starts: item.starts.map(candidate => candidate.id === start.id
    ? { ...candidate, sessionIds: [...candidate.sessionIds, id] } : candidate) });
}

export function finishTournament(diary: Diary, id: string): Diary {
  const item = diary.tournaments?.find(tournament => tournament.id === id);
  if (!item || item.completed || !item.starts.some(start => start.status === 'participated')) return diary;
  return saveTournament(diary, { ...item, completed: true });
}

export function unlinkTournamentSession(tournaments: readonly Tournament[], id: string) {
  return tournaments.map(item => ({ ...item, starts: item.starts.map(start => ({
    ...start, sessionIds: start.sessionIds.filter(session => session !== id),
  })) }));
}
