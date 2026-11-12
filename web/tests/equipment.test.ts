import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { MAX_NUMBERED_ARROWS, editEquipment, equipmentSnapshot, isEquipmentSnapshot, isLibrary, loadEquipment, saveEquipment, selectableEquipment, validNumberedCount, validShaftDiameter } from '../src/equipment.ts';
import type { EquipmentLibrary } from '../src/equipment.ts';

const key = 'app.fableshot.equipment.v1';
const library: EquipmentLibrary = {
  bows: [{ id: 'bow', name: 'Баребоу', category: 'barebow' }],
  arrows: [{ id: 'arrows', name: 'Carbon', diameterMm: 5.2 }],
  kits: [{ id: 'kit', name: 'Основной', bowId: 'bow', arrowsId: 'arrows' }],
};

function storage(t: TestContext, initial: string | null = null, failWrite = false) {
  const entries = new Map<string, string>();
  if (initial !== null) entries.set(key, initial);
  const value = {
    getItem(name: string) { return entries.get(name) ?? null; },
    setItem(name: string, raw: string) {
      if (failWrite) throw new DOMException('Storage full', 'QuotaExceededError');
      entries.set(name, raw);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'));
  return value;
}

test('stores the component library and returns an independent training snapshot', t => {
  storage(t);
  assert.deepEqual(loadEquipment(), { bows: [], arrows: [], kits: [] });
  saveEquipment(library);
  const loaded = loadEquipment();
  assert.deepEqual(loaded, library);
  const selected = equipmentSnapshot(loaded, 'kit')!;
  assert.equal(isEquipmentSnapshot(selected), true);
  assert.deepEqual(selected.arrows, { name: 'Carbon', diameterMm: 5.2 });
  loaded.bows[0].category = 'compound';
  loaded.arrows[0].diameterMm = 9.3;
  saveEquipment(loaded);
  assert.equal(selected.bow.category, 'barebow');
  assert.equal(selected.arrows.diameterMm, 5.2);
  assert.equal(equipmentSnapshot(loadEquipment(), 'kit')!.bow.category, 'compound');
});

test('allows an incomplete kit and preserves the default shaft diameter choice', t => {
  storage(t);
  const incomplete: EquipmentLibrary = { bows: [], arrows: [], kits: [{ id: 'k', name: 'Без компонентов', bowId: null, arrowsId: null }] };
  saveEquipment(incomplete);
  const selected = equipmentSnapshot(loadEquipment(), 'k')!;
  assert.equal(selected.arrows.diameterMm, null);
  assert.equal(selected.bow.category, null);
  assert.equal(isEquipmentSnapshot(selected), true);
});

test('validates the Android shaft range and the component references', t => {
  storage(t);
  assert.equal(validShaftDiameter(1), true);
  assert.equal(validShaftDiameter(20), true);
  for (const value of [0, 20.01, Infinity, NaN]) assert.equal(validShaftDiameter(value), false);
  assert.throws(() => saveEquipment({ ...library, arrows: [{ ...library.arrows[0], diameterMm: 22 }] }));
  assert.throws(() => saveEquipment({ ...library, bows: [] }));
  assert.throws(() => saveEquipment({ ...library, kits: [{ ...library.kits[0], id: 'bow' }] }));
  assert.equal(isEquipmentSnapshot({ ...equipmentSnapshot(library, 'kit'), bow: { name: 'Лук', category: 'unknown' } }), false);
});

test('freezes the physical set ID and number range in each equipment snapshot', t => {
  storage(t);
  saveEquipment({ ...library, arrows: [{ ...library.arrows[0], numberedCount: 6 }] });
  const loaded = loadEquipment();
  const selected = equipmentSnapshot(loaded, 'kit')!;
  assert.equal(isEquipmentSnapshot(selected), true);
  assert.deepEqual(selected.arrows, { id: 'arrows', name: 'Carbon', diameterMm: 5.2, numberedCount: 6 });

  loaded.arrows[0].numberedCount = MAX_NUMBERED_ARROWS;
  saveEquipment(loaded);
  assert.equal(equipmentSnapshot(loadEquipment(), 'kit')!.arrows.numberedCount, MAX_NUMBERED_ARROWS);
  delete loaded.arrows[0].numberedCount;
  saveEquipment(loaded);
  assert.deepEqual(equipmentSnapshot(loadEquipment(), 'kit')!.arrows, { name: 'Carbon', diameterMm: 5.2 });
  assert.equal(selected.arrows.numberedCount, 6);
  assert.equal(selected.arrows.id, 'arrows');
});

test('rejects invalid numbered ranges and requires a physical set ID for numbered snapshots', t => {
  const raw = JSON.stringify(library);
  const saved = storage(t, raw);
  const selected = equipmentSnapshot(library, 'kit')!;
  assert.equal(validNumberedCount(1), true);
  assert.equal(validNumberedCount(MAX_NUMBERED_ARROWS), true);
  for (const count of [0, -1, 1.5, MAX_NUMBERED_ARROWS + 1, NaN, Infinity]) {
    assert.equal(validNumberedCount(count), false);
    assert.throws(() => saveEquipment({ ...library, arrows: [{ ...library.arrows[0], numberedCount: count }] }));
  }
  for (const count of [null, '6', 0, 1.5, MAX_NUMBERED_ARROWS + 1]) {
    assert.equal(isEquipmentSnapshot({ ...selected, arrows: { ...selected.arrows, id: 'arrows', numberedCount: count } }), false);
  }
  for (const id of [undefined, '', 123]) {
    assert.equal(isEquipmentSnapshot({ ...selected, arrows: { ...selected.arrows, id, numberedCount: 6 } }), false);
  }
  assert.equal(saved.getItem(key), raw);
});

test('keeps a damaged equipment record instead of replacing it with an empty library', t => {
  const raw = '{broken';
  const saved = storage(t, raw);
  assert.throws(loadEquipment, /Исходная запись сохранена/);
  assert.throws(() => saveEquipment(library), /Исходная запись сохранена/);
  assert.equal(saved.getItem(key), raw);
});

test('surfaces quota failure without reporting the changed kit as saved', t => {
  const raw = JSON.stringify(library);
  const saved = storage(t, raw, true);
  assert.throws(() => saveEquipment({ ...library, kits: [{ ...library.kits[0], name: 'Другое имя' }] }), /Storage full/);
  assert.equal(saved.getItem(key), raw);
});

test('favorites are exclusive per kind and changing a favorite advances both item revisions', () => {
  const first = editEquipment(library, { kind: 'bows', value: { ...library.bows[0], favorite: true } }, 100);
  const both = editEquipment(first, { kind: 'bows', value: { id: 'other', name: 'Второй', category: null, favorite: true } }, 200);
  const next = editEquipment(both, { kind: 'arrows', value: { ...both.arrows[0], favorite: true } }, 300);
  assert.deepEqual(next.bows.map(item => [item.favorite, item.revision, item.createdAtMs, item.updatedAtMs]), [[false, 2, 100, 200], [true, 1, 200, 200]]);
  assert.equal(next.arrows[0].favorite, true);
  assert.equal(first.bows[0].favorite, true);
  assert.throws(() => editEquipment(next, { kind: 'bows', value: { ...first.bows[0], name: 'Старая правка' } }, 400), /уже изменилась/);
});

test('archiving a component clears its favorite and excludes linked kits while stored snapshots stay intact', () => {
  const before = editEquipment(library, { kind: 'bows', value: { ...library.bows[0], favorite: true, model: 'Model', drawLengthIn: 28.5 } }, 100);
  const historical = equipmentSnapshot(before, 'kit')!;
  const next = editEquipment(before, { kind: 'bows', value: { ...before.bows[0], archived: true } }, 200);
  assert.equal(next.bows[0].favorite, false);
  assert.deepEqual(selectableEquipment(next).kits, []);
  assert.equal(equipmentSnapshot(next, 'kit'), null);
  assert.equal(historical.bow.model, 'Model');
  assert.equal(historical.bow.drawLengthIn, 28.5);
  assert.equal(historical.bow.favorite, true);
  assert.ok(isEquipmentSnapshot(historical));
  assert.throws(() => editEquipment(next, { kind: 'kits', value: { id: 'new', name: 'Комплект', bowId: 'bow', arrowsId: null } }, 300), /действующего/);
  const restored = editEquipment(next, { kind: 'bows', value: { ...next.bows[0], archived: false } }, 400);
  assert.equal(restored.bows[0].favorite, false);
  assert.equal(selectableEquipment(restored).kits[0].id, 'kit');
});

test('equipment editor preserves imported metadata and complete historical parameter snapshots', () => {
  const imported = { ...library, arrows: [{ ...library.arrows[0], spine: 600, lengthMm: 700, massGrain: 270, model: 'Carbon',
    revision: 3, createdAtMs: 50, updatedAtMs: 80, vendor: { batch: '7' } }] };
  const historical = equipmentSnapshot(imported, 'kit')!;
  const edited = editEquipment(imported, { kind: 'arrows', value: { id: 'arrows', revision: 3, name: '  Новый набор  ', diameterMm: 5.5 } }, 100);
  assert.equal(edited.arrows[0].name, 'Новый набор');
  assert.equal(edited.arrows[0].createdAtMs, 50);
  assert.equal(edited.arrows[0].revision, 4);
  assert.deepEqual(edited.arrows[0], { ...imported.arrows[0], name: 'Новый набор', diameterMm: 5.5, revision: 4, updatedAtMs: 100 });
  assert.equal(historical.arrows.diameterMm, 5.2);
  assert.equal(historical.arrows.spine, 600);
  assert.equal(historical.arrows.lengthMm, 700);
  assert.equal(historical.arrows.massGrain, 270);
  imported.arrows[0].vendor.batch = '8';
  assert.deepEqual((historical.arrows as { vendor?: unknown }).vendor, { batch: '7' });
});

test('equipment validates optional native fields and rejects a stale library save', t => {
  const saved = storage(t, JSON.stringify(library));
  assert.equal(isLibrary({ ...library, bows: [{ ...library.bows[0], drawWeightLb: -1 }] }), false);
  assert.equal(isLibrary({ ...library, arrows: [{ ...library.arrows[0], spine: 1.5 }] }), false);
  assert.equal(isLibrary({ ...library, arrows: [{ ...library.arrows[0], massGrain: Infinity }] }), false);
  assert.equal(isLibrary({ ...library, kits: [{ ...library.kits[0], notes: 'x'.repeat(2001) }] }), false);
  assert.equal(isLibrary({ ...library, kits: [{ ...library.kits[0], revision: -1 }] }), false);
  const initial = loadEquipment();
  const edited = editEquipment(initial, { kind: 'kits', value: { ...initial.kits[0], name: 'Новое имя' } }, 100);
  saveEquipment(edited, initial);
  assert.throws(() => saveEquipment(initial, initial), /изменилось после открытия/);
  assert.equal(saved.getItem(key), JSON.stringify(edited));
});
