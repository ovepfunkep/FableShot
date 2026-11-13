import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { isConditions } from './conditions.ts';
import type { Conditions } from './conditions.ts';
import type { EquipmentLibrary } from './equipment.ts';
import { mergeMyTargets } from './mytargets-conversion.ts';
import { parseMyTargets } from './mytargets-import.ts';
import type { MyTargetsPreview, MyTargetsRound } from './mytargets-import.ts';
import { DIARY_KEY } from './persistence.ts';
import type { Diary } from './persistence.ts';
import { awardServiceAction } from './achievement-diary.ts';
import { TARGET_PROFILES } from './target.ts';
import { captureArchiveState, replaceArchiveRecords } from './web-archive.ts';
import './mytargets-import.css';

const EQUIPMENT_KEY = 'app.fableshot.equipment.v1';
const PAGE_SIZE = 40;
type Mapping = { distance: string; profile: string; diameter: string };
type ImportContext = {
  preview: MyTargetsPreview; expected: ReturnType<typeof captureArchiveState>;
  diary: Diary; equipment: EquipmentLibrary; importedAt: string; name: string;
};
const confirmations: Record<string, string> = {
  unknown_date: 'Дата этих тренировок неизвестна. Они сохранятся без даты.',
  conditions_mapping: 'Неизвестные условия нужно указать вручную. Раунды без выбранных условий будут пропущены.',
  session_boundary: 'В CSV возможны неоднозначные границы тренировок. Проверьте список перед добавлением.',
  csv_conditions_and_series_plan: 'В CSV нет надёжного плана серий. Сохраняются фактически записанные стрелы и исходные границы серий.',
  equipment_mapping: 'Названия луков, наборов стрел и комплектов из CSV будут добавлены. Тип лука, диаметр и количество стрел неизвестны — их можно уточнить в снаряжении.',
};
const warningMessages: Record<string, string> = {
  unknown_date: 'Неизвестная дата', unknown_end_time: 'Неизвестное время серии',
  conditions_mapping_required: 'Нужно указать условия раунда', csv_equipment_mapping_required: 'Снаряжение CSV переносится по названиям; тип лука и параметры стрел неизвестны',
  ambiguous_session_boundary: 'Неоднозначная граница тренировки', unsupported_score: 'Неподдерживаемые очки — серия пропущена',
  unsupported_archive_score: 'Неподдерживаемые очки — серия пропущена', unsupported_shot: 'Неподдерживаемая стрела пропущена',
  invalid_round_or_end_number: 'Недопустимый номер раунда или серии', invalid_series_size: 'Некорректный размер серии',
  invalid_archive_series: 'Некорректный размер серии', archive_series_totals_mismatch: 'Итоги серии не совпадают с исходными стрелами',
  invalid_coordinate_pair: 'Координаты отсутствуют или повреждены', unverified_coordinate: 'Координаты не подтверждены и не переносятся',
  coordinate_not_preserved: 'Недопустимые координаты не перенесены', invalid_arrow_number: 'Недопустимый или повторный номер стрелы не перенесён',
  already_imported: 'Эта стрела уже импортирована', possible_overlap: 'Возможное совпадение с другим файлом — серия пропущена',
  overlap_explicitly_allowed: 'Возможное совпадение разрешено вручную', attachments_retained_only_in_source: 'Вложения остаются только в исходном архиве',
  equipment_name_mapping_required: 'Снаряжение без допустимого названия пропущено', unknown_bow_category: 'Тип лука неизвестен',
  extra_source_columns_retained_in_source: 'Дополнительные столбцы остаются в исходном CSV',
};

function errorMessage(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'QuotaExceededError') return 'Недостаточно места для сохранения импорта и резервной копии. Дневник не изменён.';
  const message = cause instanceof Error ? cause.message : '';
  if (/equipment_id_conflict/.test(message)) return 'Снаряжение с таким идентификатором уже есть, но его данные отличаются. Импорт остановлен; дневник не изменён.';
  if (/file_too_large/.test(message)) return 'Выберите ZIP или CSV размером до 25 МБ.';
  if (/no_importable_shots/.test(message)) return 'В файле не найдены записанные стрелы MyTargets.';
  if (/csv_unsupported_headers/.test(message)) return 'Не распознаны столбцы CSV. Нужен полный экспорт MyTargets с очками, сериями и координатами.';
  if (/confirmation_required/.test(message)) return 'Подтвердите особенности выбранных данных перед добавлением.';
  if (/[а-яё]/i.test(message)) return message;
  return 'Не удалось подготовить импорт. Проверьте, что это полный экспорт ZIP или CSV из MyTargets.';
}
function draftFor(round: MyTargetsRound, drafts: Record<string, Mapping>): Mapping {
  return drafts[round.sourceId] ?? { distance: String(round.rawConditions.distanceMeters ?? ''), profile: '', diameter: String(round.rawConditions.targetDiameterMm ?? '') };
}

export function MyTargetsImport({ onClose }: { onClose: () => void }) {
  const [context, setContext] = useState<ImportContext | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [mappingCount, setMappingCount] = useState(PAGE_SIZE);
  const [drafts, setDrafts] = useState<Record<string, Mapping>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [allowOverlaps, setAllowOverlaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false), running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const selection = useMemo(() => new Set(selected), [selected]);
  const selectedSessions = useMemo(() => context?.preview.sessions.filter(session => selection.has(session.sourceId)) ?? [], [context, selection]);
  const selectedSources = useMemo(() => new Set(selectedSessions.flatMap(session => [session.sourceId,
    ...session.rounds.flatMap(round => [round.sourceId, ...round.series.flatMap(series => [series.sourceId, ...series.shots.map(shot => shot.sourceId)])])])), [selectedSessions]);
  const required = useMemo(() => context?.preview.requiredConfirmations.filter(key => selectedSources.has(key.slice(key.indexOf(':') + 1))) ?? [], [context, selectedSources]);
  const confirmationGroups = useMemo(() => {
    const groups = new Map<string, number>();
    for (const key of required) { const code = key.slice(0, key.indexOf(':')); groups.set(code, (groups.get(code) ?? 0) + 1); }
    return [...groups];
  }, [required]);
  const unknownRounds = useMemo(() => selectedSessions.flatMap(session => session.rounds.filter(round => !round.conditions)
    .map(round => ({ round, title: session.title || 'Без названия' }))), [selectedSessions]);
  const overrides = useMemo(() => {
    const result: Record<string, Conditions> = {};
    for (const { round } of unknownRounds) {
      const draft = draftFor(round, drafts);
      const conditions = { distanceMeters: Number(draft.distance), targetProfileId: draft.profile, targetDiameterMm: Number(draft.diameter), equipment: null };
      if (isConditions(conditions)) result[round.sourceId] = conditions;
    }
    return result;
  }, [unknownRounds, drafts]);
  const proposal = useMemo(() => {
    if (!context || required.length && !confirmed) return { result: null, error: '' };
    try {
      return { result: mergeMyTargets(context.preview, context.diary, context.equipment, { selectedSessionIds: selected,
        confirmedBoundaries: required, allowOverlaps, conditionsOverrides: overrides, importedAt: context.importedAt }), error: '' };
    } catch (cause) { return { result: null, error: errorMessage(cause) }; }
  }, [context, selected, required, confirmed, allowOverlaps, overrides]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return context?.preview.sessions.filter(session => !query || `${session.title} ${session.localDate ?? session.rawDate}`.toLocaleLowerCase().includes(query)) ?? [];
  }, [context, search]);
  const selectedShots = selectedSessions.reduce((total, session) => total + session.rounds.reduce((sum, round) => sum + round.series.reduce((sum, series) => sum + series.shots.length, 0), 0), 0);
  const unmappedCount = unknownRounds.filter(({ round }) => !overrides[round.sourceId]).length;
  const warnings = proposal.result?.warnings ?? context?.preview.warnings ?? [];
  const warningGroups = new Map<string, number>();
  for (const warning of warnings) warningGroups.set(warning.code, (warningGroups.get(warning.code) ?? 0) + 1);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || running.current) return;
    running.current = true; setBusy(true); setError(''); setContext(null); setConfirmed(false); setDrafts({}); setAllowOverlaps(false);
    setSearch(''); setVisibleCount(PAGE_SIZE); setMappingCount(PAGE_SIZE);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('file_too_large');
      const expected = captureArchiveState();
      const diary = JSON.parse(expected.records[DIARY_KEY] ?? '{"version":1,"entries":[]}') as Diary;
      const equipment = JSON.parse(expected.records[EQUIPMENT_KEY] ?? '{"bows":[],"arrows":[],"kits":[]}') as EquipmentLibrary;
      const preview = await parseMyTargets(new Uint8Array(await file.arrayBuffer()));
      if (alive.current) {
        setContext({ preview, expected, diary, equipment, importedAt: new Date().toISOString(), name: file.name });
        setSelected(preview.sessions.map(session => session.sourceId));
      }
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  function select(ids: string[]) { setSelected(ids); setConfirmed(false); setError(''); }
  function mapRound(round: MyTargetsRound, patch: Partial<Mapping>) {
    setDrafts(current => ({ ...current, [round.sourceId]: { ...draftFor(round, current), ...patch } }));
    setConfirmed(false); setError('');
  }
  function apply() {
    if (!context || !proposal.result?.addedShots || running.current || required.length && !confirmed) return;
    running.current = true; setBusy(true); setError('');
    try {
      const records = structuredClone(context.expected.records);
      records[DIARY_KEY] = JSON.stringify(awardServiceAction(proposal.result.diary, 'APP01', new Date().toISOString()));
      records[EQUIPMENT_KEY] = JSON.stringify(proposal.result.equipment);
      replaceArchiveRecords(records, context.expected);
      window.location.reload();
    } catch (cause) { setError(errorMessage(cause)); running.current = false; setBusy(false); }
  }

  return <BottomSheet title="Импорт из MyTargets" onClose={onClose} tag="mytargets-import">
    <div className="mytargets-import">
      <p>Добавьте тренировки из ZIP или CSV MyTargets. Перед сохранением можно проверить данные и выбрать тренировки.</p>
      <label className="mytargets-file">Выбрать ZIP или CSV · до 25 МБ
        <input type="file" accept=".zip,.csv,application/zip,text/csv" disabled={busy} onChange={event => void choose(event)} data-testid="mytargets-file" />
      </label>
      {busy && <p role="status">{context ? 'Сохраняю импорт…' : 'Читаю и проверяю файл…'}</p>}
      {context && <>
        <div className="mytargets-summary" data-testid="mytargets-preview">
          <strong>{context.name}</strong>
          <span>Найдено тренировок: {context.preview.sessions.length}. Выбрано: {selectedSessions.length}, стрел: {selectedShots}.</span>
          {context.preview.skippedEmptySlots > 0 && <span>Пустых ячеек в источнике: {context.preview.skippedEmptySlots}. Они не считаются стрелами.</span>}
        </div>
        <label className="mytargets-search">Найти тренировку<input type="search" value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="Название или дата" data-testid="mytargets-search" /></label>
        <div className="mytargets-selection-actions">
          <button type="button" disabled={busy} onClick={() => select(context.preview.sessions.map(session => session.sourceId))}>Выбрать все</button>
          <button type="button" disabled={busy} onClick={() => select([])}>Снять выбор</button>
        </div>
        <div className="mytargets-sessions">
          {filtered.slice(0, visibleCount).map(session => <label key={session.sourceId} className="mytargets-session">
            <input type="checkbox" checked={selection.has(session.sourceId)} disabled={busy} onChange={event => select(event.target.checked ? [...selected, session.sourceId] : selected.filter(id => id !== session.sourceId))} />
            <span><strong>{session.title || 'Без названия'}</strong><small>{session.localDate ?? 'Дата неизвестна'} · {session.rounds.reduce((sum, round) => sum + round.series.reduce((sum, series) => sum + series.shots.length, 0), 0)} стрел</small></span>
          </label>)}
          {!filtered.length && <p>Тренировки не найдены.</p>}
        </div>
        {filtered.length > visibleCount && <button type="button" className="mytargets-more" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>Показать ещё ({filtered.length - visibleCount})</button>}
        {unknownRounds.length > 0 && <details className="mytargets-details">
          <summary>Указать неизвестные условия ({unknownRounds.length})</summary>
          <p>Выберите мишень, дистанцию и диаметр. Пока условия не заданы, стрелы этого раунда будут пропущены.</p>
          {unknownRounds.slice(0, mappingCount).map(({ round, title }) => {
            const draft = draftFor(round, drafts);
            return <fieldset key={round.sourceId} className="mytargets-mapping" disabled={busy}>
              <legend>{title} · раунд {round.rawConditions.round}</legend>
              <p>{round.rawConditions.distance || 'Дистанция неизвестна'} · {round.rawConditions.target || 'Мишень неизвестна'}</p>
              <label>Дистанция, м<input type="number" min="0.01" step="any" value={draft.distance} onChange={event => mapRound(round, { distance: event.target.value })} /></label>
              <label>Мишень<select value={draft.profile} onChange={event => {
                const profile = TARGET_PROFILES.find(profile => profile.id === event.target.value);
                mapRound(round, { profile: event.target.value, ...(profile?.diameters.length && !profile.diameters.includes(Number(draft.diameter)) ? { diameter: String(profile.diameters[0]) } : {}) });
              }}><option value="">Выберите мишень</option>{TARGET_PROFILES.map(profile => <option key={profile.id} value={profile.id}>{profile.title}</option>)}</select></label>
              <label>Диаметр, мм<input type="number" min="1" max="10000" step="1" value={draft.diameter} onChange={event => mapRound(round, { diameter: event.target.value })} /></label>
              <small>{overrides[round.sourceId] ? 'Условия выбраны' : 'Раунд будет пропущен'}</small>
            </fieldset>;
          })}
          {unknownRounds.length > mappingCount && <button type="button" className="mytargets-more" onClick={() => setMappingCount(count => count + PAGE_SIZE)}>Ещё раунды ({unknownRounds.length - mappingCount})</button>}
        </details>}
        {unmappedCount > 0 && <p className="mytargets-warning">Без выбранных условий останутся за пределами импорта раунды: {unmappedCount}. Укажите условия выше или снимите выбор этих тренировок.</p>}
        {required.length > 0 && <>
          <details className="mytargets-details"><summary>Что нужно подтвердить ({required.length})</summary><ul>{confirmationGroups.map(([code, count]) => <li key={code}>{confirmations[code] ?? 'Проверьте особенности исходных данных.'} ({count})</li>)}</ul></details>
          <label className="mytargets-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => { setConfirmed(event.target.checked); setError(''); }} data-testid="mytargets-confirm" /><span>Я проверил выбранные тренировки и подтверждаю перечисленные особенности и пропуски.</span></label>
        </>}
        <label className="mytargets-check"><input type="checkbox" checked={allowOverlaps} disabled={busy} onChange={event => setAllowOverlaps(event.target.checked)} data-testid="mytargets-allow-overlaps" /><span>Разрешить возможные совпадения с другими файлами. Это может добавить повторные тренировки.</span></label>
        {warnings.length > 0 && <details className="mytargets-details"><summary>Замечания к данным ({warnings.length})</summary><ul>{[...warningGroups].map(([code, count]) => <li key={code}>{warningMessages[code] ?? 'Особенность исходных данных требует проверки'}: {count}</li>)}</ul></details>}
        {proposal.result && <p role="status" data-testid="mytargets-result">Будет добавлено тренировок: {proposal.result.addedTrainings}, стрел: {proposal.result.addedShots}. Пропущено стрел: {proposal.result.skippedShots}.</p>}
        {proposal.result && !proposal.result.addedShots && <p className="mytargets-warning">Новых стрел для добавления нет. Проверьте выбор, условия и замечания о совпадениях.</p>}
        {!selectedSessions.length && <p className="mytargets-warning">Выберите хотя бы одну тренировку для добавления.</p>}
        {selectedSessions.length > 0 && required.length > 0 && !confirmed && <p>Чтобы увидеть итог и добавить стрелы, отметьте подтверждение особенностей выбранных данных.</p>}
        <p className="mytargets-caption">Перед добавлением автоматически сохраняется локальная резервная копия текущего дневника. Исходный файл остаётся у вас.</p>
        <button type="button" className="mytargets-apply" disabled={busy || !proposal.result?.addedShots} onClick={apply} data-testid="mytargets-apply">Добавить в дневник</button>
      </>}
      {(error || proposal.error) && <p role="alert">{error || proposal.error}</p>}
      <button type="button" className="mytargets-close" disabled={busy} onClick={onClose}>Закрыть</button>
    </div>
  </BottomSheet>;
}
