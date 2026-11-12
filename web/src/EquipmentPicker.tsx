import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { BOW_CATEGORIES, MAX_NUMBERED_ARROWS, bowCategoryName, editEquipment, equipmentSnapshot, loadEquipment, saveEquipment, selectableEquipment, validNumberedCount, validShaftDiameter } from './equipment.ts';
import type { EquipmentArrows, EquipmentBow, EquipmentEdit, EquipmentItem, EquipmentKind, EquipmentKit, EquipmentLibrary, EquipmentSnapshot } from './equipment.ts';
import './equipment.css';

type ComponentDraft = { kind: 'bow'; value: EquipmentBow } | { kind: 'arrows'; value: EquipmentArrows };
const newId = () => crypto.randomUUID();

function Pencil() {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="m15 4 5 5M4 15 16 3l5 5L9 20l-6 1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>;
}

function initialLibrary(): { library: EquipmentLibrary | null; error: string } {
  try { return { library: loadEquipment(), error: '' }; }
  catch (error) { return { library: null, error: error instanceof Error ? error.message : 'Не удалось прочитать снаряжение.' }; }
}

const detailFields = {
  bows: [['drawWeightLb', 'Сила натяжения, фунты'], ['drawLengthIn', 'Длина растяжки, дюймы']],
  arrows: [['spine', 'Спайн'], ['lengthMm', 'Длина, мм'], ['massGrain', 'Масса, граны']],
  kits: [],
} as const;

export function EquipmentDetailFields({ kind, value, onNotesChange }: {
  kind: EquipmentKind; value: EquipmentItem; onNotesChange?: (notes: string) => void;
}) {
  return <>
    {kind !== 'kits' && <label className="equipment-field">Модель<input name="model" maxLength={100} defaultValue={value.model ?? ''} /></label>}
    {detailFields[kind].map(([key, label]) => <label className="equipment-field" key={key}>{label}
      <input name={key} inputMode={key === 'spine' ? 'numeric' : 'decimal'} maxLength={24} defaultValue={(value as Partial<EquipmentBow & EquipmentArrows>)[key] ?? ''} />
    </label>)}
    <label className="equipment-field">Заметки<textarea name="notes" rows={2} maxLength={2000}
      {...(onNotesChange ? { value: value.notes ?? '', onChange: event => onNotesChange(event.target.value) } : { defaultValue: value.notes ?? '' })} /></label>
  </>;
}

export function readEquipmentDetails(kind: EquipmentKind, form: HTMLFormElement) {
  const fields = new FormData(form);
  const details: Record<string, string | number | null> = {};
  for (const key of ['model', 'notes']) {
    const raw = fields.get(key);
    if (typeof raw === 'string') details[key] = raw.trim() || null;
  }
  for (const [key, label] of detailFields[kind]) {
    const raw = String(fields.get(key) ?? '').trim();
    if (!raw) { details[key] = null; continue; }
    const parsed = Number(raw.replace(',', '.'));
    if (!/^\d+(?:[.,]\d+)?$/.test(raw) || !Number.isFinite(parsed) || parsed <= 0 ||
      key === 'spine' && (!Number.isInteger(parsed) || parsed > 2_147_483_647)) throw new Error(`Проверьте значение «${label}».`);
    details[key] = parsed;
  }
  return details;
}

function ComponentChoices({ title, values, selected, onSelect, onAdd, onEdit, kind }: {
  title: string; values: readonly { id: string; name: string }[]; selected: string | null;
  onSelect: (id: string | null) => void; onAdd: () => void; onEdit: (id: string) => void; kind: 'bow' | 'arrows';
}) {
  return <section className="equipment-components">
    <h3>{title}</h3>
    <div className="equipment-choice-row">
      <button type="button" className="equipment-chip" aria-pressed={selected === null} onClick={() => onSelect(null)}>Без выбора</button>
      {values.map(item => <span className={`equipment-chip-group${item.id === selected ? ' is-selected' : ''}`} key={item.id}>
        <button type="button" className="equipment-chip" aria-pressed={item.id === selected}
          data-testid={`equipment-select-${item.id}`} onClick={() => onSelect(item.id)}>{item.name}</button>
        {item.id === selected && <button type="button" className="equipment-icon" aria-label={`Изменить ${kind === 'bow' ? 'лук' : 'стрелы'}`}
          onClick={() => onEdit(item.id)}><Pencil /></button>}
      </span>)}
      <button type="button" className="equipment-icon" aria-label={kind === 'bow' ? 'Добавить лук' : 'Добавить стрелы'} onClick={onAdd}>+</button>
    </div>
  </section>;
}

export function EquipmentPicker({ selected, onSelect, onClose, editSelected = false }: {
  selected: EquipmentSnapshot | null; onSelect: (value: EquipmentSnapshot | null) => void; onClose: () => void;
  editSelected?: boolean;
}) {
  const [state, setState] = useState(initialLibrary);
  const [kit, setKit] = useState<EquipmentKit | null>(() => editSelected && selected && state.library
    ? selectableEquipment(state.library).kits.find(item => item.id === selected.id) ?? null : null);
  const [component, setComponent] = useState<ComponentDraft | null>(null);
  const [diameter, setDiameter] = useState('');
  const [numberedCount, setNumberedCount] = useState('');
  const sheet = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const drag = useRef<{ id: number; y: number } | null>(null);
  const library = state.library;
  const available = library && selectableEquipment(library);
  const chosen = available && selected ? available.kits.find(item => item.id === selected.id) : null;
  const preview = chosen && library ? equipmentSnapshot(library, chosen.id) : selected;
  const parsedDiameter = diameter.trim() ? Number(diameter.replace(',', '.')) : null;
  const diameterValid = parsedDiameter === null || validShaftDiameter(parsedDiameter);
  const countText = numberedCount.trim();
  const parsedNumberedCount = countText ? Number(countText) : undefined;
  const numberedCountValid = parsedNumberedCount === undefined || (/^\d+$/.test(countText) && validNumberedCount(parsedNumberedCount));

  useLayoutEffect(() => { sheet.current?.showModal(); }, []);
  function persist(draft: EquipmentEdit, form: HTMLFormElement): EquipmentLibrary | null {
    if (!library) return null;
    try {
      const edit = { ...draft, value: { ...draft.value, ...readEquipmentDetails(draft.kind, form) } } as EquipmentEdit;
      const next = editEquipment(library, edit);
      saveEquipment(next, library);
      setState({ library: next, error: '' });
      return next;
    } catch (error) {
      setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Не удалось сохранить снаряжение.' }));
      return null;
    }
  }

  function beginComponent(kind: 'bow' | 'arrows', id?: string) {
    if (!library) return;
    if (kind === 'bow') {
      setComponent({ kind, value: library.bows.find(item => item.id === id) ?? { id: newId(), name: '', category: null } });
    } else {
      const value: EquipmentArrows = library.arrows.find(item => item.id === id) ?? { id: newId(), name: '', diameterMm: null };
      setDiameter(value.diameterMm?.toString().replace('.', ',') ?? '');
      setNumberedCount(value.numberedCount?.toString() ?? '');
      setComponent({ kind, value });
    }
  }

  function saveComponent(form: HTMLFormElement) {
    if (!component || !library || !kit) return;
    const creating = !(component.kind === 'bow' ? library.bows : library.arrows).some(item => item.id === component.value.id);
    const value = { ...component.value, name: component.value.name.trim() };
    if (component.kind === 'bow') {
      const bow = value as EquipmentBow;
      if (persist({ kind: 'bows', value: bow }, form)) {
        if (creating) setKit({ ...kit, bowId: bow.id });
        setComponent(null);
      }
    } else {
      if (!diameterValid || !numberedCountValid) return;
      const arrows: EquipmentArrows = { ...component.value, name: value.name, diameterMm: parsedDiameter, numberedCount: parsedNumberedCount };
      if (persist({ kind: 'arrows', value: arrows }, form)) {
        if (creating) setKit({ ...kit, arrowsId: arrows.id });
        setComponent(null);
      }
    }
  }

  function saveKit(form: HTMLFormElement) {
    if (!kit || !library) return;
    const value = { ...kit, name: kit.name.trim() };
    const next = persist({ kind: 'kits', value }, form);
    if (next) {
      onSelect(equipmentSnapshot(next, value.id));
      onClose();
    }
  }

  function dismiss() {
    if (component) setComponent(null);
    else if (kit) setKit(null);
    else onClose();
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    drag.current = { id: event.pointerId, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.id === event.pointerId && event.clientY - drag.current.y > 64) dismiss();
    drag.current = null;
  }

  const title = component ? component.kind === 'bow' ? 'Лук' : 'Стрелы' : kit ? 'Комплект снаряжения' : 'Комплект';
  return <dialog ref={sheet} className="equipment-sheet" aria-labelledby={titleId} data-testid="conditions-equipment-sheet"
    onCancel={event => { event.preventDefault(); dismiss(); }} onClick={event => {
      if (event.target === event.currentTarget) {
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss();
      }
    }}>
    <header className="equipment-sheet-header" onPointerDown={startDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }}>
      <span className="equipment-handle" aria-hidden="true" />
      <h2 id={titleId}>{title}</h2>
    </header>
    <div className="equipment-sheet-content">
      {state.error && <p role="alert" className="equipment-error">{state.error}</p>}
      {component ? <form className="equipment-form" key={component.value.id} onSubmit={event => { event.preventDefault(); saveComponent(event.currentTarget); }}>
        <label className="equipment-field">Название
          <input autoFocus value={component.value.name} maxLength={100} data-testid="equipment-name"
            onChange={event => setComponent({ ...component, value: { ...component.value, name: event.target.value } } as ComponentDraft)} />
        </label>
        {component.kind === 'bow' ? <div className="equipment-categories" role="group" aria-label="Тип лука">
          <button type="button" className="equipment-chip" aria-pressed={component.value.category === null}
            onClick={() => setComponent({ kind: 'bow', value: { ...component.value, category: null } })}>Не указан</button>
          {BOW_CATEGORIES.map(category => <button key={category.value} type="button" className="equipment-chip"
            aria-pressed={component.value.category === category.value} data-testid={`bow-category-${category.value}`}
            onClick={() => setComponent({ kind: 'bow', value: { ...component.value, category: category.value } })}>{category.label}</button>)}
        </div> : <div className="equipment-arrow-fields">
          <div className="equipment-field">
            <label htmlFor={`${titleId}-diameter`}>Диаметр стрелы, мм</label>
            <input id={`${titleId}-diameter`} value={diameter} inputMode="decimal" maxLength={12} data-testid="equipment-field-diameterMm"
              aria-invalid={!diameterValid} aria-describedby={`${titleId}-diameter-hint`} onChange={event => setDiameter(event.target.value)} />
            <small id={`${titleId}-diameter-hint`}>1–20 мм · по умолчанию 6 мм</small>
          </div>
          <div className="equipment-field">
            <label htmlFor={`${titleId}-numbered-count`}>Номерных стрел, шт.</label>
            <input id={`${titleId}-numbered-count`} value={numberedCount} inputMode="numeric" data-testid="equipment-numbered-count"
              aria-invalid={!numberedCountValid} aria-describedby={`${titleId}-numbered-count-hint`} onChange={event => setNumberedCount(event.target.value)} />
            <small id={`${titleId}-numbered-count-hint`}>1–{MAX_NUMBERED_ARROWS} · пусто для стрел без номеров</small>
          </div>
        </div>}
        <EquipmentDetailFields kind={component.kind === 'bow' ? 'bows' : 'arrows'} value={component.value} />
        <div className="equipment-form-actions">
          <button type="button" className="equipment-cancel" onClick={() => setComponent(null)}>Отмена</button>
          <button type="submit" className="primary" data-testid="equipment-component-save"
            disabled={!component.value.name.trim() || (component.kind === 'arrows' && (!diameterValid || !numberedCountValid))}>Сохранить</button>
        </div>
      </form> : kit && library && available ? <form className="equipment-form" key={kit.id} onSubmit={event => { event.preventDefault(); saveKit(event.currentTarget); }}>
        <label className="equipment-field">Название
          <input autoFocus value={kit.name} maxLength={100} data-testid="equipment-name" onChange={event => setKit({ ...kit, name: event.target.value })} />
        </label>
        <ComponentChoices title="Луки" kind="bow" values={available.bows} selected={kit.bowId}
          onSelect={bowId => setKit({ ...kit, bowId })} onAdd={() => beginComponent('bow')} onEdit={id => beginComponent('bow', id)} />
        <ComponentChoices title="Стрелы" kind="arrows" values={available.arrows} selected={kit.arrowsId}
          onSelect={arrowsId => setKit({ ...kit, arrowsId })} onAdd={() => beginComponent('arrows')} onEdit={id => beginComponent('arrows', id)} />
        <EquipmentDetailFields kind="kits" value={kit} onNotesChange={notes => setKit({ ...kit, notes })} />
        <div className="equipment-form-actions">
          <button type="button" className="equipment-cancel" onClick={() => setKit(null)}>Отмена</button>
          <button type="submit" className="primary" data-testid="equipment-save" disabled={!kit.name.trim()}>Сохранить</button>
        </div>
      </form> : <>
        <div className="equipment-choice-row" role="group" aria-label="Снаряжение">
          <button type="button" className="equipment-chip" aria-pressed={selected === null} data-testid="equipment-none"
            onClick={() => { onSelect(null); onClose(); }}>Без комплекта</button>
          {library && available?.kits.map(item => <span className={`equipment-chip-group${item.id === selected?.id ? ' is-selected' : ''}`} key={item.id}>
            <button type="button" className="equipment-chip" aria-pressed={item.id === selected?.id} data-testid={`equipment-select-${item.id}`}
              onClick={() => { onSelect(equipmentSnapshot(library, item.id)); onClose(); }}>{item.name}</button>
            {item.id === selected?.id && <button type="button" className="equipment-icon" aria-label="Изменить выбранный комплект"
              data-testid={`equipment-edit-choice-${item.id}`} onClick={() => setKit({ ...item })}><Pencil /></button>}
          </span>)}
          <button type="button" className="equipment-icon" aria-label="Добавить комплект" data-testid="equipment-add-choice" disabled={!library}
            onClick={() => setKit({ id: newId(), name: '', bowId: null, arrowsId: null })}>+</button>
        </div>
        {preview && <div className="equipment-preview">
          <div><span>Лук</span><strong>{preview.bow.name || 'Без выбора'}</strong><small>{bowCategoryName(preview.bow.category)}</small></div>
          <div><span>Стрелы</span><strong>{preview.arrows.name || 'Без выбора'}</strong>
            <small>{preview.arrows.diameterMm ?? 6} мм{preview.arrows.numberedCount !== undefined && ` · № 1–${preview.arrows.numberedCount}`}</small>
          </div>
        </div>}
        {available?.kits.length === 0 && <p className="equipment-empty">Добавь комплект из лука и стрел.</p>}
        {selected && !chosen && <p className="equipment-empty">Сохранённый комплект · {selected.name}</p>}
      </>}
    </div>
  </dialog>;
}
