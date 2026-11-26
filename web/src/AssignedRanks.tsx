import { ChoicePicker } from './ChoicePicker.tsx';
import { useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import { archiveRankAssignment, isRankAssignment, isRankAssignmentDate, RANK_DISCIPLINES, RANK_LEVELS, saveRankAssignment, visibleRankAssignments } from './assigned-ranks.ts';
import type { RankAssignment, RankCategory, RankDiscipline, RankLevel } from './assigned-ranks.ts';
import './assigned-ranks.css';

type Draft = Omit<RankAssignment, 'category' | 'assignedOn'> & { category: RankCategory | ''; assignedOn: string };
type Panel = { mode: 'list' } | { mode: 'editor' | 'archive'; draft: Draft };

function Pencil() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="m4 16 12-12 4 4L8 20H4zm9-9 4 4" />
  </svg>;
}

function newDraft(category?: RankCategory): Draft {
  const now = Date.now();
  return { id: crypto.randomUUID(), discipline: 'recurve', category: category ?? '', level: 'III', assignedOn: '',
    issuedBy: '', reference: '', current: true, createdAtMs: now, updatedAtMs: now, revision: 0, deletedAtMs: null };
}

export function AssignedRanks({ assignments, onChange, defaultCategory }: {
  assignments: readonly RankAssignment[];
  onChange: (next: RankAssignment[]) => Promise<boolean>;
  defaultCategory?: RankCategory;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState('');
  const rows = visibleRankAssignments(assignments);
  const current = rows.filter(row => row.current);
  const summary = current.length === 1 ? `${current[0].level} · ${RANK_DISCIPLINES[current[0].discipline]}` :
    current.length ? `Текущих: ${current.length}` : '—';
  const draft = panel && panel.mode !== 'list' ? panel.draft : null;
  const edited = draft ? { ...draft, assignedOn: draft.assignedOn.trim() || null, issuedBy: draft.issuedBy.trim(), reference: draft.reference.trim() } : null;
  const editingExisting = !!draft && assignments.some(row => row.id === draft.id);

  function show(next: Panel | null) {
    setError('');
    setPanel(next);
  }

  function editField<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    if (panel?.mode === 'editor') show({ mode: 'editor', draft: { ...panel.draft, [key]: value } });
  }

  async function write(action: () => RankAssignment[]) {
    try {
      if (await onChange(action())) show({ mode: 'list' });
      else setError('Не удалось сохранить отметку. Попробуй ещё раз.');
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'rank_assignment_conflict' ?
        'Отметка изменилась. Вернись к списку и открой её заново.' : 'Не удалось сохранить отметку. Проверь введённые данные.');
    }
  }

  return <>
    <div className="profile-panel profile-metric assigned-ranks-tile" data-testid="profile-assigned-rank">
      <Icon name="podium" />
      <div><strong data-testid="assigned-summary">{summary}</strong><span>Присвоенный разряд</span></div>
      <button type="button" className="icon-button" aria-label="Просмотр и редактирование присвоенных разрядов"
        data-testid="assigned-open" onClick={() => show({ mode: 'list' })}><Pencil /></button>
    </div>
    {panel && <BottomSheet title={panel.mode === 'list' ? 'Присвоенные разряды' : panel.mode === 'archive' ? 'Архивировать отметку разряда?' :
      editingExisting ? 'Изменить отметку' : 'Добавить присвоенный разряд'} tag={`assigned-${panel.mode}-sheet`} onClose={() => show(null)}>
      {panel.mode === 'list' && <div className="assigned-ranks-list">
        {rows.length ? <ul>{rows.map(row => <li key={row.id} data-testid={`assigned-rank-${row.id}`}>
          <div>
            <strong>{RANK_DISCIPLINES[row.discipline]} ({row.category === 'male' ? 'М' : 'Ж'}) · {row.level}</strong>
            <span>{row.assignedOn && <><time dateTime={row.assignedOn}>{row.assignedOn}</time> · </>}{row.current ? 'Текущий' : 'В истории'}</span>
            {row.issuedBy && <span>{row.issuedBy}</span>}
            {row.reference && <span>{row.reference}</span>}
          </div>
          <button type="button" className="icon-button" aria-label={`Изменить разряд ${row.level} · ${RANK_DISCIPLINES[row.discipline]}`}
            data-testid={`assigned-edit-${row.id}`} onClick={() => show({ mode: 'editor', draft: { ...row, assignedOn: row.assignedOn ?? '' } })}><Pencil /></button>
        </li>)}</ul> : <p>Присвоенные разряды пока не указаны.</p>}
        <button type="button" className="primary" data-testid="assigned-add" onClick={() => show({ mode: 'editor', draft: newDraft(defaultCategory) })}>
          Добавить присвоенный разряд
        </button>
      </div>}
      {panel.mode === 'editor' && draft && <form className="assigned-ranks-form" onSubmit={event => {
        event.preventDefault();
        if (isRankAssignment(edited)) write(() => saveRankAssignment(assignments, edited, Date.now()));
      }}>
        <ChoicePicker label="Дисциплина" value={draft.discipline} testId="assigned-discipline"
          onChange={value => editField('discipline', value as RankDiscipline)}
          options={Object.entries(RANK_DISCIPLINES).map(([value, label]) => ({ value, label }))} />
        <ChoicePicker label="Категория" value={draft.category} testId="assigned-category" placeholder="Выбрать категорию"
          onChange={value => editField('category', value as Draft['category'])}
          options={[{ value: 'male', label: 'Мужчины' }, { value: 'female', label: 'Женщины' }]} />
        <ChoicePicker label="Разряд или звание" value={draft.level} testId="assigned-level"
          onChange={value => editField('level', value as RankLevel)} options={RANK_LEVELS.map(level => ({ value: level, label: level }))} />
        <label>Дата присвоения<input placeholder="ГГГГ-ММ-ДД" maxLength={16} value={draft.assignedOn} data-testid="assigned-date"
          aria-invalid={!!draft.assignedOn.trim() && !isRankAssignmentDate(draft.assignedOn.trim())}
          onChange={event => editField('assignedOn', event.target.value)} /></label>
        <label>Кем присвоен<input maxLength={120} value={draft.issuedBy} data-testid="assigned-issuer" onChange={event => editField('issuedBy', event.target.value)} /></label>
        <label>Приказ или примечание<textarea maxLength={500} rows={2} value={draft.reference} data-testid="assigned-reference"
          onChange={event => editField('reference', event.target.value)} /></label>
        <label className="assigned-ranks-current"><input type="checkbox" checked={draft.current} data-testid="assigned-current"
          onChange={event => editField('current', event.target.checked)} />Текущий разряд для дисциплины и категории</label>
        {error && <p role="alert" data-testid="assigned-error">{error}</p>}
        <button type="submit" className="primary" disabled={!isRankAssignment(edited)} data-testid="assigned-save">Сохранить</button>
        <div className="assigned-ranks-actions">
          <button type="button" onClick={() => show({ mode: 'list' })}>К списку</button>
          {editingExisting && <button type="button" data-testid="assigned-archive" onClick={() => show({ mode: 'archive', draft })}>Архивировать</button>}
        </div>
      </form>}
      {panel.mode === 'archive' && draft && <div className="assigned-ranks-form">
        <p>{RANK_DISCIPLINES[draft.discipline]} · {draft.level}</p>
        {error && <p role="alert" data-testid="assigned-error">{error}</p>}
        <button type="button" className="primary" data-testid="assigned-archive-confirm"
          onClick={() => write(() => archiveRankAssignment(assignments, draft.id, draft.revision, Date.now()))}>Архивировать</button>
        <div className="assigned-ranks-actions"><button type="button" onClick={() => show({ mode: 'editor', draft })}>Отмена</button></div>
      </div>}
    </BottomSheet>}
  </>;
}
