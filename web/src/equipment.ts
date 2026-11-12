import { appStorage } from './app-storage.ts';
export const BOW_CATEGORIES = [
  { value: 'barebow', label: 'Баребоу' },
  { value: 'recurve', label: 'Классический' },
  { value: 'compound', label: 'Блочный' },
  { value: 'traditional', label: 'Традиционный' },
  { value: 'longbow', label: 'Лонгбоу' },
  { value: 'other', label: 'Другой' },
] as const;

export const MAX_NUMBERED_ARROWS = 1000;

type EquipmentMetadata = {
  model?: string | null;
  notes?: string | null;
  favorite?: boolean;
  archived?: boolean;
  revision?: number;
  createdAtMs?: number;
  updatedAtMs?: number;
};
type BowDetails = { drawWeightLb?: number | null; drawLengthIn?: number | null };
type ArrowDetails = { spine?: number | null; lengthMm?: number | null; massGrain?: number | null };
export type EquipmentSnapshot = EquipmentMetadata & {
  id: string;
  name: string;
  bowId?: string | null;
  arrowsId?: string | null;
  bow: EquipmentMetadata & BowDetails & { name: string; category: string | null; id?: string };
  arrows: EquipmentMetadata & ArrowDetails & { name: string; diameterMm: number | null; numberedCount?: number; id?: string };
};
export type EquipmentBow = EquipmentMetadata & BowDetails & { id: string; name: string; category: string | null };
export type EquipmentArrows = EquipmentMetadata & ArrowDetails & { id: string; name: string; diameterMm: number | null; numberedCount?: number };
export type EquipmentKit = EquipmentMetadata & { id: string; name: string; bowId: string | null; arrowsId: string | null };
export type EquipmentLibrary = { bows: EquipmentBow[]; arrows: EquipmentArrows[]; kits: EquipmentKit[] };
export type EquipmentKind = keyof EquipmentLibrary;
export type EquipmentEdit = { [Kind in EquipmentKind]: { kind: Kind; value: EquipmentLibrary[Kind][number] } }[EquipmentKind];
export type EquipmentItem = EquipmentEdit['value'];

const storageKey = 'app.fableshot.equipment.v1';
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100;
const validOptionalName = (value: unknown): value is string => typeof value === 'string' && value.length <= 100;
const validCategory = (value: unknown): value is string | null => value === null || BOW_CATEGORIES.some(item => item.value === value);
const optionalText = (value: unknown, max: number) => value == null || typeof value === 'string' && value.length <= max;
const optionalPositive = (value: unknown) => value == null || typeof value === 'number' && Number.isFinite(value) && value > 0;
const counter = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function validMetadata(value: EquipmentMetadata) {
  return optionalText(value.model, 100) && optionalText(value.notes, 2000) &&
    [value.revision, value.createdAtMs, value.updatedAtMs].every(part => part === undefined || counter(part)) &&
    [value.favorite, value.archived].every(part => part === undefined || typeof part === 'boolean') &&
    !(value.archived && value.favorite);
}

function validBow(value: BowDetails & { category: unknown }) {
  return validCategory(value.category) && optionalPositive(value.drawWeightLb) && optionalPositive(value.drawLengthIn);
}

function validArrows(value: ArrowDetails & { diameterMm: unknown; numberedCount?: unknown }) {
  return (value.diameterMm === null || validShaftDiameter(value.diameterMm)) &&
    (value.numberedCount === undefined || validNumberedCount(value.numberedCount)) &&
    (value.spine == null || Number.isInteger(value.spine) && value.spine > 0 && value.spine <= 2_147_483_647) &&
    optionalPositive(value.lengthMm) && optionalPositive(value.massGrain);
}

export function validShaftDiameter(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 20;
}

export function validNumberedCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_NUMBERED_ARROWS;
}

export function isEquipmentSnapshot(value: unknown): value is EquipmentSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<EquipmentSnapshot>;
  const { id, name, bow, arrows, bowId, arrowsId } = snapshot;
  return validId(id) && validName(name) && validMetadata(snapshot) &&
    (bowId == null || validId(bowId)) && (arrowsId == null || validId(arrowsId)) &&
    !!bow && typeof bow === 'object' && validOptionalName(bow.name) && validMetadata(bow) && validBow(bow) &&
    (bow.id === undefined || validId(bow.id)) && !!arrows && typeof arrows === 'object' &&
    validOptionalName(arrows.name) && validMetadata(arrows) && validArrows(arrows) &&
    (arrows.id === undefined ? arrows.numberedCount === undefined : validId(arrows.id));
}

export function isLibrary(value: unknown): value is EquipmentLibrary {
  if (!value || typeof value !== 'object') return false;
  const { bows, arrows, kits } = value as Partial<EquipmentLibrary>;
  if (!Array.isArray(bows) || !Array.isArray(arrows) || !Array.isArray(kits) ||
    bows.length > 1000 || arrows.length > 1000 || kits.length > 1000) return false;
  const ids = new Set<string>();
  for (const item of [...bows, ...arrows, ...kits]) {
    if (!item || typeof item !== 'object' || !validId(item.id) || !validName(item.name) || !validMetadata(item) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  if (!bows.every(validBow) || !arrows.every(validArrows) ||
    [bows, arrows, kits].some(items => items.filter(item => item.favorite).length > 1)) return false;
  return kits.every(item => (item.bowId === null || bows.some(bow => bow.id === item.bowId)) &&
    (item.arrowsId === null || arrows.some(arrow => arrow.id === item.arrowsId)));
}

export function loadEquipment(): EquipmentLibrary {
  const raw = appStorage.getItem(storageKey);
  if (raw === null) return { bows: [], arrows: [], kits: [] };
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (cause) { throw new Error('Не удалось прочитать снаряжение. Исходная запись сохранена.', { cause }); }
  if (!isLibrary(value)) throw new Error('Неверный формат снаряжения. Исходная запись сохранена.');
  return value;
}

export function saveEquipment(value: EquipmentLibrary, expected?: EquipmentLibrary): void {
  if (!isLibrary(value)) throw new Error('Проверьте название и параметры снаряжения.');
  const current = loadEquipment();
  if (expected && JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Снаряжение изменилось после открытия. Откройте редактор заново.');
  appStorage.setItem(storageKey, JSON.stringify(value));
}

export function kitAvailable(library: EquipmentLibrary, kit: EquipmentKit): boolean {
  return !kit.archived && (kit.bowId === null || library.bows.some(bow => bow.id === kit.bowId && !bow.archived)) &&
    (kit.arrowsId === null || library.arrows.some(arrows => arrows.id === kit.arrowsId && !arrows.archived));
}

export function selectableEquipment(library: EquipmentLibrary): EquipmentLibrary {
  return { bows: library.bows.filter(item => !item.archived), arrows: library.arrows.filter(item => !item.archived),
    kits: library.kits.filter(item => kitAvailable(library, item)) };
}

/** Apply one revision to the current library and preserve opaque fields from imported entries. */
export function editEquipment(library: EquipmentLibrary, edit: EquipmentEdit, nowMs = Date.now()): EquipmentLibrary {
  const { kind, value } = edit;
  const current = library[kind].find(item => item.id === value.id);
  if ((current?.revision ?? 0) !== (value.revision ?? 0)) throw new Error('Эта запись снаряжения уже изменилась. Откройте редактор заново.');
  const revised = (previous: EquipmentItem | undefined, patch: EquipmentItem): EquipmentItem => ({
    ...previous, ...patch, name: patch.name.trim(),
    ...(patch.model === undefined ? {} : { model: patch.model?.trim() || null }),
    ...(patch.notes === undefined ? {} : { notes: patch.notes?.trim() || null }),
    revision: (previous?.revision ?? 0) + 1,
    createdAtMs: previous?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
  });
  const nextItem = revised(current, value);
  if (nextItem.archived && nextItem.favorite) nextItem.favorite = false;
  if (kind === 'kits') {
    const previous = current as EquipmentKit | undefined;
    if ((value.bowId !== null && value.bowId !== previous?.bowId && !library.bows.some(bow => bow.id === value.bowId && !bow.archived)) ||
      (value.arrowsId !== null && value.arrowsId !== previous?.arrowsId && !library.arrows.some(arrows => arrows.id === value.arrowsId && !arrows.archived))) {
      throw new Error('Выберите лук и стрелы из действующего снаряжения.');
    }
  }
  const rows = library[kind].map(item => {
    if (item.id === value.id) return nextItem;
    return nextItem.favorite && item.favorite ? revised(item, { ...item, favorite: false }) : item;
  });
  if (!current) rows.push(nextItem);
  const next = { ...library, [kind]: rows };
  if (!isLibrary(next)) throw new Error('Проверьте название и параметры снаряжения.');
  return next;
}

export function equipmentSnapshot(library: EquipmentLibrary, id: string): EquipmentSnapshot | null {
  const kit = library.kits.find(item => item.id === id);
  if (!kit || !kitAvailable(library, kit)) return null;
  const bow = library.bows.find(item => item.id === kit.bowId);
  const arrows = library.arrows.find(item => item.id === kit.arrowsId);
  const { id: arrowsId, ...arrowDetails } = arrows ?? { id: undefined, name: '', diameterMm: null };
  return structuredClone({ ...kit, bow: bow ?? { name: '', category: null },
    arrows: arrows?.numberedCount === undefined ? arrowDetails : { ...arrowDetails, id: arrowsId } });
}

export function bowCategoryName(value: string | null): string {
  return BOW_CATEGORIES.find(item => item.value === value)?.label ?? 'Не указан';
}
