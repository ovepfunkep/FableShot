import { useId, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { BOW_CATEGORIES, MAX_NUMBERED_ARROWS, bowCategoryName, editEquipment, equipmentSnapshot, kitAvailable, loadEquipment, saveEquipment, validNumberedCount, validShaftDiameter } from './equipment.ts';
import type { EquipmentArrows, EquipmentBow, EquipmentEdit, EquipmentItem, EquipmentKind, EquipmentKit, EquipmentLibrary, EquipmentSnapshot } from './equipment.ts';
import { EquipmentDetailFields, readEquipmentDetails } from './EquipmentPicker.tsx';
import { Icon } from './TrainingChrome.tsx';
import './equipment-catalog.css';

type Kind = EquipmentKind;
type Draft = EquipmentEdit;
const labels: Record<Kind, string> = { bows: 'Луки', arrows: 'Стрелы', kits: 'Комплекты' };
const singular: Record<Kind, string> = { bows: 'лук', arrows: 'стрелы', kits: 'комплект' };
const paths = {
  bows: 'M7 3q16 9 0 18M7 3v18M3 12h17m-4-4 4 4-4 4',
  arrows: 'm5 20 14-14m-6-1h7v7M4 15v5h5',
  kits: 'M4 7h16v14H4zM8 7V3h8v4M4 12h16m-10 0v4h4v-4',
  edit: 'm15 4 5 5M4 15 16 3l5 5L9 20l-6 1z',
  diameter: 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0m2 7L19 5',
  number: 'M9 3 6 21M18 3l-3 18M4 9h17M3 15h17',
  favorite: 'm12 3 2.8 5.9 6.5.9-4.7 4.6 1.1 6.5-5.7-3.1-5.7 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 3Z',
  archive: 'M3 4h18v5H3zM5 9v11h14V9M9 13h6',
  restore: 'M4 11a8 8 0 1 1 2 7M4 5v6h6',
  model: 'M4 5h10l6 6v8H4zM14 5v6h6',
  length: 'M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4',
  weight: 'M9 7a3 3 0 1 1 6 0M7 7h10l3 13H4z',
};
function CatalogIcon({ kind, filled = false }: { kind: keyof typeof paths; filled?: boolean }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} aria-hidden="true"><path d={paths[kind]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function readLibrary(): { library: EquipmentLibrary | null; error: string } {
  try { return { library: loadEquipment(), error: '' }; }
  catch (cause) { return { library: null, error: cause instanceof Error ? cause.message : 'Не удалось прочитать снаряжение.' }; }
}
function itemDraft(kind: Kind, value: EquipmentItem): Draft {
  if (kind === 'bows') return { kind, value: value as EquipmentBow };
  if (kind === 'arrows') return { kind, value: value as EquipmentArrows };
  return { kind, value: value as EquipmentKit };
}

function CatalogValues({ kind, item, library }: { kind: Kind; item: EquipmentItem; library: EquipmentLibrary }) {
  const values: [keyof typeof paths, string][] = [];
  if (item.model) values.push(['model', item.model]);
  if (kind === 'bows') {
    const bow = item as EquipmentBow;
    values.push(['bows', bowCategoryName(bow.category)]);
    if (bow.drawWeightLb != null) values.push(['weight', `${bow.drawWeightLb} фунтов`]);
    if (bow.drawLengthIn != null) values.push(['length', `${bow.drawLengthIn} дюймов`]);
  } else if (kind === 'arrows') {
    const arrows = item as EquipmentArrows;
    values.push(['diameter', arrows.diameterMm === null ? 'Диаметр не указан' : `${arrows.diameterMm} мм`]);
    if (arrows.numberedCount !== undefined) values.push(['number', `№ 1–${arrows.numberedCount}`]);
    if (arrows.spine != null) values.push(['arrows', `Спайн ${arrows.spine}`]);
    if (arrows.lengthMm != null) values.push(['length', `${arrows.lengthMm} мм`]);
    if (arrows.massGrain != null) values.push(['weight', `${arrows.massGrain} гран`]);
  } else {
    const kit = item as EquipmentKit;
    const bow = library.bows.find(row => row.id === kit.bowId);
    const arrows = library.arrows.find(row => row.id === kit.arrowsId);
    values.push(['bows', bow ? `${bow.name}${bow.archived ? ' (архив)' : ''}` : 'Лук не выбран'],
      ['arrows', arrows ? `${arrows.name}${arrows.archived ? ' (архив)' : ''}` : 'Стрелы не выбраны']);
  }
  return <><div className="equipment-catalog-values">{values.map(([icon, value]) => <span key={icon}><CatalogIcon kind={icon} />{value}</span>)}</div>
    {item.notes && <p className="equipment-catalog-notes">{item.notes}</p>}</>;
}

export function EquipmentCatalog({ onBack, onSelect }: {
  onBack?: () => void; onSelect?: (equipment: EquipmentSnapshot) => void;
}) {
  const [state, setState] = useState(readLibrary);
  const [kind, setKind] = useState<Kind>('bows');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [diameter, setDiameter] = useState('');
  const [numberedCount, setNumberedCount] = useState('');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [visible, setVisible] = useState(40);
  const fieldId = useId();
  const library = state.library;
  const parsedDiameter = diameter.trim() ? Number(diameter.trim().replace(',', '.')) : null;
  const parsedCount = numberedCount.trim() ? Number(numberedCount) : undefined;
  const diameterValid = parsedDiameter === null || validShaftDiameter(parsedDiameter);
  const countValid = parsedCount === undefined || /^\d+$/.test(numberedCount.trim()) && validNumberedCount(parsedCount);

  function edit(value: Draft) {
    setDraft(structuredClone(value));
    setState(current => ({ ...current, error: '' }));
    if (value.kind === 'arrows') {
      setDiameter(value.value.diameterMm?.toString().replace('.', ',') ?? '');
      setNumberedCount(value.value.numberedCount?.toString() ?? '');
    }
  }
  function add() {
    const id = crypto.randomUUID();
    setArchived(false);
    if (kind === 'bows') edit({ kind, value: { id, name: '', category: null } });
    else if (kind === 'arrows') edit({ kind, value: { id, name: '', diameterMm: null } });
    else edit({ kind, value: { id, name: '', bowId: null, arrowsId: null } });
  }
  function persist(edit: Draft) {
    if (!library) return false;
    try {
      const next = editEquipment(library, edit);
      saveEquipment(next, library);
      setState({ library: next, error: '' });
      return true;
    } catch (cause) {
      setState(current => ({ ...current, error: cause instanceof Error ? cause.message : 'Не удалось сохранить снаряжение.' }));
      return false;
    }
  }
  function save(form: HTMLFormElement) {
    if (!draft || !library || !draft.value.name.trim()) return;
    try {
      const details = readEquipmentDetails(draft.kind, form);
      if (draft.kind === 'arrows' && (!diameterValid || !countValid)) return;
      const arrowFields = draft.kind === 'arrows' ? { diameterMm: parsedDiameter, numberedCount: parsedCount } : {};
      if (persist(itemDraft(draft.kind, { ...draft.value, ...details, ...arrowFields }))) setDraft(null);
    } catch (cause) { setState(current => ({ ...current, error: cause instanceof Error ? cause.message : 'Не удалось сохранить снаряжение.' })); }
  }
  function dismiss() { setDraft(null); }
  const values = library?.[kind].filter(value => !!value.archived === archived && value.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => Number(!!right.favorite) - Number(!!left.favorite) || (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0)) ?? [];
  const editorTitle = draft && library?.[draft.kind].some(item => item.id === draft.value.id)
    ? `Изменить ${singular[draft.kind]}` : draft?.kind === 'arrows' ? 'Новые стрелы' : draft?.kind === 'bows' ? 'Новый лук' : 'Новый комплект';

  return <section className="equipment-catalog" aria-label="Моё снаряжение" data-testid="equipment-catalog">
    <header className="equipment-catalog-header">
      {onBack && <button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button>}
      <CatalogIcon kind="kits" /><h1>Моё снаряжение</h1>
      <button type="button" className="equipment-catalog-add" aria-label={`Добавить ${singular[kind]}`} data-testid="equipment-catalog-add" disabled={!library} onClick={add}>+</button>
    </header>
    <div className="equipment-catalog-tabs" role="group" aria-label="Вид снаряжения">
      {(['bows', 'arrows', 'kits'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} data-testid={`equipment-catalog-tab-${value}`} onClick={() => { setKind(value); setQuery(''); setVisible(40); }}>
        <CatalogIcon kind={value} />{labels[value]}{library && <small>{library[value].length}</small>}
      </button>)}
    </div>
    {state.error && !draft && <div className="equipment-catalog-error" role="alert"><p>{state.error}</p><button type="button" onClick={() => setState(readLibrary())}>Обновить список</button></div>}
    {library && <>
      <button type="button" className="equipment-catalog-archive-filter" aria-pressed={archived} data-testid="equipment-catalog-show-archive"
        onClick={() => { setArchived(value => !value); setQuery(''); setVisible(40); }}><CatalogIcon kind="archive" />Архив</button>
      {library[kind].length > 0 && <label className="equipment-catalog-search">Найти по названию<input type="search" value={query} placeholder={labels[kind]} onChange={event => { setQuery(event.target.value); setVisible(40); }} /></label>}
      {!values.length && <div className="equipment-catalog-empty"><CatalogIcon kind={kind} /><p>{query.trim() ? 'По этому названию ничего не найдено.' : archived ? 'В архиве пока ничего нет.' : `Здесь пока нет снаряжения. Добавьте ${singular[kind]} кнопкой «+».`}</p></div>}
      <div className="equipment-catalog-items">
        {values.slice(0, visible).map(item => {
          const available = kind !== 'kits' || kitAvailable(library, item as EquipmentKit);
          return <article className="equipment-catalog-card" key={item.id} data-testid={`equipment-catalog-card-${item.id}`}>
            <header><CatalogIcon kind={kind} /><h2>{item.name}</h2><button type="button" className="icon-button" aria-label={`Изменить ${item.name}`}
              data-testid={`equipment-catalog-edit-${item.id}`} onClick={() => edit(itemDraft(kind, item))}><CatalogIcon kind="edit" /></button></header>
            <CatalogValues kind={kind} item={item} library={library} />
            {!archived && !available && <p className="equipment-catalog-notes">В комплекте есть архивное снаряжение.</p>}
            <footer className="equipment-catalog-actions">
              {!item.archived && <button type="button" className="icon-button equipment-catalog-star" aria-label={item.favorite ? `Убрать ${item.name} из избранного` : `Добавить ${item.name} в избранное`}
                aria-pressed={!!item.favorite} data-testid={`equipment-catalog-favorite-${item.id}`} onClick={() => persist(itemDraft(kind, { ...item, favorite: !item.favorite }))}>
                <CatalogIcon kind="favorite" filled={!!item.favorite} />
              </button>}
              <button type="button" className="equipment-catalog-archive" data-testid={`equipment-catalog-archive-${item.id}`}
                onClick={() => persist(itemDraft(kind, { ...item, archived: !item.archived }))}>
                <CatalogIcon kind={item.archived ? 'restore' : 'archive'} />{item.archived ? 'Вернуть из архива' : 'В архив'}
              </button>
            </footer>
            {kind === 'kits' && available && onSelect && <button type="button" className="equipment-catalog-select" onClick={() => { const value = equipmentSnapshot(library, item.id); if (value) onSelect(value); }}>Выбрать комплект</button>}
          </article>;
        })}
      </div>
      {values.length > visible && <button type="button" className="equipment-catalog-more" onClick={() => setVisible(count => count + 40)}>Показать ещё ({values.length - visible})</button>}
    </>}
    {draft && library && <BottomSheet title={editorTitle} onClose={dismiss} tag="equipment-catalog-editor">
      <form className="equipment-catalog-form" onSubmit={event => { event.preventDefault(); save(event.currentTarget); }}>
        <label>Название<input autoFocus maxLength={100} value={draft.value.name} data-testid="equipment-catalog-name" onChange={event => setDraft({ ...draft, value: { ...draft.value, name: event.target.value } } as Draft)} /></label>
        {draft.kind === 'bows' && <label>Тип лука<select value={draft.value.category ?? ''} data-testid="equipment-catalog-category" onChange={event => setDraft({ ...draft, value: { ...draft.value, category: event.target.value || null } })}>
          <option value="">Не указан</option>{BOW_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select></label>}
        {draft.kind === 'arrows' && <>
          <label htmlFor={`${fieldId}-diameter`}>Диаметр стрелы, мм<input id={`${fieldId}-diameter`} inputMode="decimal" value={diameter} aria-invalid={!diameterValid} data-testid="equipment-catalog-diameter" onChange={event => setDiameter(event.target.value)} /><small>1–20 мм. Оставьте пустым, если неизвестен.</small></label>
          <label htmlFor={`${fieldId}-count`}>Номерных стрел, шт.<input id={`${fieldId}-count`} inputMode="numeric" value={numberedCount} aria-invalid={!countValid} data-testid="equipment-catalog-numbered-count" onChange={event => setNumberedCount(event.target.value)} /><small>1–{MAX_NUMBERED_ARROWS}. Пустое поле — нумерация не задана.</small></label>
          {(!diameterValid || !countValid) && <p role="alert">Проверьте диаметр и целое количество номерных стрел.</p>}
        </>}
        {draft.kind === 'kits' && <>
          <label>Лук<select value={draft.value.bowId ?? ''} data-testid="equipment-catalog-kit-bow" onChange={event => setDraft({ ...draft, value: { ...draft.value, bowId: event.target.value || null } })}>
            <option value="">Без выбора</option>{library.bows.filter(bow => !bow.archived || bow.id === (draft.value as EquipmentKit).bowId).map(bow => <option value={bow.id} key={bow.id}>{bow.name}{bow.archived ? ' (архив)' : ''}</option>)}
          </select></label>
          <label>Стрелы<select value={draft.value.arrowsId ?? ''} data-testid="equipment-catalog-kit-arrows" onChange={event => setDraft({ ...draft, value: { ...draft.value, arrowsId: event.target.value || null } })}>
            <option value="">Без выбора</option>{library.arrows.filter(arrows => !arrows.archived || arrows.id === (draft.value as EquipmentKit).arrowsId).map(arrows => <option value={arrows.id} key={arrows.id}>{arrows.name}{arrows.archived ? ' (архив)' : ''}</option>)}
          </select></label>
        </>}
        <EquipmentDetailFields kind={draft.kind} value={draft.value} />
        {state.error && <p role="alert">{state.error}</p>}
        <div className="equipment-catalog-form-actions"><button type="button" onClick={dismiss}>Отмена</button><button type="submit" className="primary" data-testid="equipment-catalog-save" disabled={!draft.value.name.trim() || draft.kind === 'arrows' && (!diameterValid || !countValid)}>Сохранить</button></div>
      </form>
    </BottomSheet>}
  </section>;
}
