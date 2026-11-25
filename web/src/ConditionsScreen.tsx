import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EquipmentPicker } from './EquipmentPicker.tsx';
import { equipmentSnapshot, loadEquipment } from './equipment.ts';
import { Icon } from './TrainingChrome.tsx';
import { TargetPreview } from './TargetBoard.tsx';
import { getTargetProfile, acceptsDiameter, TARGET_PROFILES } from './target.ts';
import { isConditions, isRoundRule, loadPresets, savePreset, removePreset } from './conditions.ts';
import type { Conditions, RoundRule, TrainingPreset } from './conditions.ts';
import { TrainingPreferenceControls } from './TrainingPreferences.tsx';
import { tournamentTitle } from './tournaments.ts';
import type { Tournament, TournamentChoice } from './tournaments.ts';
import { ConditionsCorrectionReview, preparePracticeConditionsCorrection } from './practice.ts';
import type { Practice } from './practice.ts';
import { TrainingTitleSuggestions } from './TrainingTitleSuggestions.tsx';
import { TripleTargetControls } from './TripleTargetControls.tsx';
import './conditions.css';

export function BottomSheet({ title, onClose, children, tag, headerAction, headerLeading, startAtTop, onDismissRequest, className }: {
  title: string; onClose: () => void; children: ReactNode; tag?: string; headerAction?: ReactNode; startAtTop?: boolean;
  onDismissRequest?: () => boolean;
  className?: string;
  headerLeading?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; height: number } | null>(null);
  const backdropPress = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    dialog.current?.showModal();
    return () => window.clearTimeout(closeTimer.current);
  }, []);
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!startAtTop || !panel) return;
    panel.focus({ preventScroll: true });
    panel.scrollTop = 0;
  }, [startAtTop]);

  function resetDrag(panel: HTMLDialogElement) {
    drag.current = null;
    delete panel.dataset.sheetDragging;
    panel.style.removeProperty('--sheet-shift');
    panel.style.removeProperty('--sheet-scrim-opacity');
  }

  function finishDismiss() {
    const panel = dialog.current;
    if (!panel?.hasAttribute('data-sheet-closing')) return;
    window.clearTimeout(closeTimer.current);
    delete panel.dataset.sheetClosing;
    close.current();
  }

  function dismiss() {
    const panel = dialog.current;
    if (!panel?.open || panel.hasAttribute('data-sheet-closing')) return;
    resetDrag(panel);
    if (onDismissRequest && !onDismissRequest()) return;
    if (document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      close.current();
      return;
    }
    panel.dataset.sheetClosing = '';
    // A hidden document can interrupt the transition without delivering transitionend.
    closeTimer.current = window.setTimeout(finishDismiss, 260);
  }

  return <dialog ref={dialog} className={className ? `condition-sheet ${className}` : 'condition-sheet'} aria-label={title} data-testid={tag} tabIndex={startAtTop ? -1 : undefined}
    onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); event.stopPropagation(); dismiss(); }}
    onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'transform') finishDismiss(); }}
    onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }}
    onClickCapture={event => {
      if (event.currentTarget.hasAttribute('data-sheet-closing')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }}
    onClick={event => {
      if (backdropPress.current && event.target === event.currentTarget) dismiss();
      backdropPress.current = false;
    }}>
    <div className="condition-sheet-body">
      <header onPointerDown={event => {
        const panel = dialog.current;
        if (!event.isPrimary || event.button !== 0 || !panel || panel.hasAttribute('data-sheet-closing') ||
          event.target instanceof Element && event.target.closest('button, a, input, select')) return;
        drag.current = { pointerId: event.pointerId, startY: event.clientY, height: panel.offsetHeight };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
        onPointerMove={event => {
          const panel = dialog.current, current = drag.current;
          if (!panel || current?.pointerId !== event.pointerId) return;
          const distance = Math.min(current.height, Math.max(0, event.clientY - current.startY));
          if (distance === 0 && !panel.hasAttribute('data-sheet-dragging')) return;
          panel.dataset.sheetDragging = '';
          panel.style.setProperty('--sheet-shift', `${distance}px`);
          panel.style.setProperty('--sheet-scrim-opacity', String(1 - distance / current.height));
        }}
        onPointerUp={event => {
          const panel = dialog.current, current = drag.current;
          if (!panel || current?.pointerId !== event.pointerId) return;
          if (event.clientY - current.startY > 65) dismiss();
          else resetDrag(panel);
        }}
        onLostPointerCapture={event => {
          const panel = dialog.current;
          if (panel && drag.current?.pointerId === event.pointerId) resetDrag(panel);
        }}>
        <span className="sheet-handle" aria-hidden="true" />
        {headerAction || headerLeading ? <div className="sheet-title-actions">{headerLeading ?? <h2>{title}</h2>}{headerAction}</div> : <h2>{title}</h2>}
      </header>
      {children}
    </div>
  </dialog>;
}

function ConditionNumber({ title, unit, value, choices, tag, invalid, onChange }: {
  title: string; unit?: string; value: string; choices: readonly number[]; tag: string; invalid: boolean;
  onChange: (value: string) => void;
}) {
  return <div className="condition-number">
    <label className={`condition-input${invalid ? ' invalid' : ''}`}>
      <span>{title}</span>
      <input type="text" inputMode="decimal" value={value} onChange={event => onChange(event.target.value)}
        aria-label={title} aria-invalid={invalid} data-testid={`${tag}-field`} maxLength={10} />
      {unit && <b>{unit}</b>}
    </label>
    <div className="condition-number-choices">
      {choices.map(choice => <button type="button" key={choice} data-testid={`${tag}-${choice}`}
        aria-pressed={Number(value.replace(',', '.')) === choice} onClick={() => onChange(String(choice))}>{choice}</button>)}
    </div>
  </div>;
}

function symbol(name: 'target' | 'kit' | 'round') {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    {name === 'target' ? <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>
      : name === 'kit' ? <><path d="M4 7h16v14H4zM9 7V3h6v4M4 12h16M10 12v3h4v-3" /></>
        : <><path d="M12 3a9 9 0 1 1-8 5M3 3v6h6M12 7v5l4 2" /></>}
  </svg>;
}

function ConditionRow({ title, value, icon, onClick, onEdit, tag }: {
  title: string; value: string; icon: 'target' | 'kit' | 'round'; onClick?: () => void; tag: string;
  onEdit?: () => void;
}) {
  const contents = <>{symbol(icon)}<span><small>{title}</small><strong>{value}</strong></span>{onClick && <Icon name="right" />}</>;
  return onClick
    ? <div className="condition-row-wrap"><button type="button" className={`condition-row${onEdit ? ' has-edit' : ''}`} onClick={onClick} data-testid={tag}>{contents}</button>
      {onEdit && <button type="button" className="icon-button condition-edit" aria-label="Изменить выбранный комплект" onClick={onEdit}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 4 5 5M4 15 16 3l5 5L9 20l-6 1z" /></svg>
      </button>}
    </div>
    : <div className="condition-row" data-testid={tag}>{contents}</div>;
}

function ruleText(rule: RoundRule): string {
  return rule.unit === 'unlimited' ? 'Без ограничения' : `${rule.limit ?? '—'} ${rule.unit === 'arrows' ? 'стрел' : 'серий'}`;
}

function readPresets() {
  try { return { presets: loadPresets(), error: '' }; }
  catch (error) { return { presets: [] as TrainingPreset[], error: error instanceof Error ? error.message : 'Не удалось прочитать избранное.' }; }
}

export function ConditionsScreen({ initial, rule, editableRule, initialNumbering, onApply, onBack, onTechnique, techniqueTitle, tournaments, achievementPreference,
  correction, onFuture, onCorrection, trainingTitles }: {
  initial: Conditions; rule: RoundRule; editableRule: boolean;
  initialNumbering: boolean | null;
  onApply: (conditions: Conditions, rule: RoundRule, numberedArrows: boolean | null, tournament?: TournamentChoice, title?: string) => Promise<boolean>; onBack: () => void;
  trainingTitles?: readonly string[];
  tournaments?: readonly Tournament[];
  achievementPreference?: ReactNode;
  onTechnique: () => void; techniqueTitle: string;
  correction?: Practice;
  onFuture?: () => void;
  onCorrection?: (source: Practice, next: Practice) => Promise<boolean>;
}) {
  const [distance, setDistance] = useState(String(initial.distanceMeters));
  const [diameter, setDiameter] = useState(String(initial.targetDiameterMm / 10));
  const [profileId, setProfileId] = useState(initial.targetProfileId);
  const [equipment, setEquipment] = useState(initial.equipment);
  const [numberedArrows, setNumberedArrows] = useState(initialNumbering);
  const [tournamentKey, setTournamentKey] = useState('');
  const [trainingTitle, setTrainingTitle] = useState('');
  const tournamentOptions = (tournaments ?? []).filter(item => !item.completed).flatMap(item =>
    item.starts.flatMap((start, index) => {
      if (start.status === 'absent') return [];
      const choice = { tournamentId: item.id, startId: start.id };
      return [{ key: JSON.stringify(choice), choice, label: `${tournamentTitle(item)} · ${start.category || `Старт ${index + 1}`}` }];
    }));
  const tournamentChoice = tournamentOptions.find(option => option.key === tournamentKey)?.choice;
  const hasNumberedSet = equipment?.arrows.numberedCount !== undefined;
  const [roundUnit, setRoundUnit] = useState(rule.unit);
  const [roundLimit, setRoundLimit] = useState(String(rule.limit ?? 30));
  const [sheet, setSheet] = useState<'target' | 'equipment' | 'round' | 'presets' | 'preset' | null>(null);
  const [editEquipment, setEditEquipment] = useState(false);
  const [presetState, setPresetState] = useState(readPresets);
  const [presetName, setPresetName] = useState('');
  const [presetQuery, setPresetQuery] = useState('');
  const [removingPreset, setRemovingPreset] = useState<TrainingPreset | null>(null);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<keyof Conditions>>(() => new Set());
  const [preview, setPreview] = useState<{ source: Practice; result: ReturnType<typeof preparePracticeConditionsCorrection> } | null>(null);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [review, setReview] = useState<ConditionsCorrectionReview | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const correctionSeries = correction?.rounds.flatMap(round => round.series) ?? [];
  const markTouched = (field: keyof Conditions) => { if (correction) setTouched(previous => new Set([...previous, field])); };
  const mixed = (field: keyof Conditions) => correctionSeries.some(series => JSON.stringify(series.conditions[field]) !== JSON.stringify(initial[field]));
  const profile = getTargetProfile(profileId)!;
  const mm = Number(diameter.replace(',', '.')) * 10;
  const meters = Number(distance.replace(',', '.'));
  const distanceValid = distance.trim() !== '' && Number.isFinite(meters) && meters > 0;
  const diameterValid = diameter.trim() !== '' && Number.isInteger(mm / 10) && mm <= 10_000 && acceptsDiameter(profile, mm);
  const nextConditions: Conditions = {
    distanceMeters: meters, targetProfileId: profileId, targetDiameterMm: mm, equipment,
  };
  const nextRule: RoundRule = editableRule
    ? { unit: roundUnit, limit: roundUnit === 'unlimited' ? null : Number(roundLimit) } : rule;
  const valid = distanceValid && diameterValid && isConditions(nextConditions) && isRoundRule(nextRule);
  const correctionChanged = !!correction && ([...touched].some(field => correctionSeries.some(series =>
    JSON.stringify(series.conditions[field]) !== JSON.stringify(nextConditions[field]))) ||
    correction.savedAt === null && (numberedArrows !== initialNumbering || nextRule.unit !== rule.unit || nextRule.limit !== rule.limit));

  function showCorrectionPreview(choices: Readonly<Record<string, string>> = {}) {
    if (!correction) return;
    try {
      const patch = Object.fromEntries([...touched].map(field => [field, nextConditions[field]])) as Partial<Conditions>;
      const result = preparePracticeConditionsCorrection(correction, patch, choices);
      if (correction.savedAt === null && editableRule && (nextRule.unit !== rule.unit || nextRule.limit !== rule.limit)) {
        result.practice = { ...result.practice, roundRule: nextRule };
      }
      if (correction.savedAt === null && numberedArrows !== initialNumbering) {
        result.practice = { ...result.practice, numberedArrows };
      }
      setError('');
      setReview(null);
      setPreview({ source: correction, result });
    } catch (cause) {
      if (cause instanceof ConditionsCorrectionReview) {
        setPreview(null);
        setReview(cause);
        setAnswers({ ...choices });
      } else setError(cause instanceof Error ? cause.message : 'Не удалось подготовить изменения.');
    }
  }

  function selectPreset(preset: TrainingPreset): boolean {
    let selectedEquipment = preset.conditions.equipment;
    try {
      if (selectedEquipment) {
        const library = loadEquipment();
        if (library.kits.some(kit => kit.id === selectedEquipment!.id)) {
          selectedEquipment = equipmentSnapshot(library, selectedEquipment.id);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось прочитать комплект.');
      return false;
    }
    setDistance(String(preset.conditions.distanceMeters));
    setDiameter(String(preset.conditions.targetDiameterMm / 10));
    setProfileId(preset.conditions.targetProfileId);
    setEquipment(selectedEquipment);
    if (editableRule) setNumberedArrows(preset.numberedArrows ?? null);
    if (editableRule) {
      setRoundUnit(preset.rule.unit);
      setRoundLimit(String(preset.rule.limit ?? 30));
    }
    return true;
  }

  async function writePreset() {
    try {
      const presets = await savePreset(presetName.trim(), nextConditions, nextRule, numberedArrows);
      setPresetState({ presets, error: '' });
      setPresetName('');
      setError('');
      setSheet(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить избранное.'); }
  }

  async function deletePreset(id: string) {
    try {
      setPresetState({ presets: await removePreset(id), error: '' });
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить набор.'); }
  }

  return <main className="conditions-page" data-testid="journal-setup">
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button>
      <h1>{correction ? 'Исправить условия' : 'Условия тренировки'}</h1>
    </header>
    <div className="conditions-content">
      {trainingTitles && <div className="training-title-field">
        <input aria-label="Название тренировки" placeholder="Название (необязательно)" maxLength={5000} value={trainingTitle}
          onChange={event => setTrainingTitle(event.currentTarget.value)} />
        <TrainingTitleSuggestions titles={trainingTitles} onChoose={setTrainingTitle} />
      </div>}
      {correction ? <div className="correction-scope">
        <span>Вся тренировка · серий {correctionSeries.length}</span>
        {onFuture && <button type="button" className="text-action" data-testid="conditions-future" onClick={onFuture}>Сменить со следующей серии</button>}
      </div> : <div className="preset-strip" aria-label="Избранные условия">
        <button type="button" className="preset-open" data-testid="training-presets" onClick={() => { setError(''); setSheet('presets'); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" /></svg>
          Избранные условия
        </button>
        <button type="button" className="icon-button preset-add" aria-label="Сохранить условия в избранное" disabled={!valid || !!presetState.error}
          onClick={() => { setError(''); setSheet('preset'); }}>+</button>
      </div>}
      {!correction && presetState.error && <p className="conditions-error" role="alert">{presetState.error}</p>}
      <div className="condition-number-grid">
        <ConditionNumber title={mixed('distanceMeters') && !touched.has('distanceMeters') ? 'Дистанция · разные' : 'Дистанция'} unit="м" tag="distance" value={distance} choices={[10, 18, 30]}
          invalid={!distanceValid} onChange={value => { setDistance(value); markTouched('distanceMeters'); }} />
        <ConditionNumber title={mixed('targetDiameterMm') && !touched.has('targetDiameterMm') ? 'Диаметр · разный' : 'Диаметр'} unit="см" tag="diameter" value={diameter} choices={profile.diameters.length ? profile.diameters.slice(0, 3).map(value => value / 10) : [40, 60, 80]}
          invalid={!diameterValid} onChange={value => { setDiameter(value); markTouched('targetDiameterMm'); }} />
      </div>
      <ConditionRow title="Мишень" value={mixed('targetProfileId') && !touched.has('targetProfileId') ? 'Разные мишени' : profile.title} icon="target" tag="target-profile-choice" onClick={() => setSheet('target')} />
      <ConditionRow title="Комплект" value={mixed('equipment') && !touched.has('equipment') ? 'Разные комплекты' : equipment?.name ?? 'Без комплекта'} icon="kit" tag="conditions-equipment"
        onClick={() => { setEditEquipment(false); setSheet('equipment'); }}
        onEdit={equipment && !correction ? () => { setEditEquipment(true); setSheet('equipment'); } : undefined} />
      <ConditionRow title="Раунд" value={ruleText(nextRule)} icon="round" tag="conditions-options"
        onClick={editableRule ? () => setSheet('round') : undefined} />
      {(!correction || correction.savedAt === null) && <details className="conditions-advanced">
        <summary data-testid="conditions-advanced"><Icon name="settings" /><span>Дополнительно</span><Icon name="right" /></summary>
        <div className="conditions-advanced-content">
          {profile.vertical && <TripleTargetControls />}
          <button type="button" className="technique-condition-link" data-testid="conditions-technique" onClick={onTechnique}>
            <Icon name="notes" /><span><strong>Памятка и фокус</strong><small>{techniqueTitle}</small></span><Icon name="right" />
          </button>
          {tournamentOptions.length > 0 && <label className="conditions-tournament">
            <Icon name="trophy" /><span>Турнир</span>
            <select aria-label="Турнирный старт" value={tournamentKey} onChange={event => setTournamentKey(event.target.value)}>
              <option value="">Обычная тренировка</option>
              {tournamentOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>}
          <div className="conditions-display-options">
            {hasNumberedSet && <div className="preference-row">
              <span className="preference-title">Нумерация стрел</span>
              <button type="button" role="switch" aria-label="Нумерация стрел" aria-checked={numberedArrows ?? true}
                data-testid="numbered-arrows-toggle" className="preference-switch" onClick={() => setNumberedArrows(!(numberedArrows ?? true))}><span /></button>
            </div>}
            <TrainingPreferenceControls keys={['hideScores', 'averageHundredths', 'showAchievementsDuringInput', 'animations', 'celebrationEffects', 'haptics', 'keepAwake', 'trainingOnLockScreen']} />
            {achievementPreference}
          </div>
        </div>
      </details>}
      {error && <p className="conditions-error" role="alert">{error}</p>}
    </div>
    <footer className="conditions-footer">
      <button type="button" className="primary" data-testid="start-training" disabled={!valid} onClick={async () => {
        if (correction) {
          if (correctionChanged) showCorrectionPreview();
          else onBack();
          return;
        }
        if (tournamentKey && !tournamentChoice) { setError('Этот турнирный старт больше недоступен. Выбери другой.'); return; }
        if (!await onApply(nextConditions, nextRule, numberedArrows, tournamentChoice, trainingTitle.trim() || undefined)) setError('Не удалось применить условия. Повтори действие.');
      }}>{correction ? correctionChanged ? 'Проверить изменения' : 'Готово' : editableRule ? 'Начать тренировку' : 'Применить условия'}</button>
    </footer>
    {review && <BottomSheet title="Сопоставить попадания" tag="conditions-correction-review" onClose={() => setReview(null)}>
      {review.choices.some(choice => choice.inOrder !== undefined) && <button type="button" className="text-action" onClick={() => setAnswers(previous => ({ ...previous,
        ...Object.fromEntries(review.choices.filter(choice => choice.inOrder !== undefined).map(choice => [choice.key, String(choice.inOrder! + 1)])) }))}>Пятна 1–2–3 по порядку стрел</button>}
      <div className="correction-review">
        {review.choices.map(choice => <label key={choice.key}>{choice.label}
          <select value={answers[choice.key] ?? ''} onChange={event => setAnswers({ ...answers, [choice.key]: event.target.value })}>
            <option value="">Выбрать</option>{choice.codes.map(code => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>)}
      </div>
      <button type="button" className="primary" disabled={review.choices.some(choice => !answers[choice.key])}
        onClick={() => showCorrectionPreview(answers)}>Проверить изменения</button>
    </BottomSheet>}
    {preview && <BottomSheet title="Применить ко всей тренировке?" tag="conditions-correction-preview" onClose={() => { if (!savingCorrection) setPreview(null); }}>
      <p>Серий с изменениями {preview.result.changedSeriesIds.length} из {correctionSeries.length}</p>
      <p>Очки {preview.result.preview.before} → {preview.result.preview.after}</p>
      {preview.result.preview.preservedScores > 0 && <p>Сохранены исходные оценки стрел · {preview.result.preview.preservedScores}</p>}
      {error && <p className="conditions-error" role="alert">{error}</p>}
      <button type="button" className="primary" data-testid="conditions-correction-save" disabled={savingCorrection} onClick={async () => {
        setSavingCorrection(true);
        try {
          if (correction !== preview.source) { showCorrectionPreview(); return; }
          if (!await onCorrection?.(preview.source, preview.result.practice)) setError('Не удалось сохранить условия. Проверь изменения и повтори.');
        } finally { setSavingCorrection(false); }
      }}>Сохранить условия</button>
    </BottomSheet>}
    {sheet === 'equipment' && <EquipmentPicker selected={equipment} onSelect={value => { setEquipment(value); markTouched('equipment'); }}
      onClose={() => setSheet(null)} editSelected={editEquipment} selectionOnly={!!correction} />}
    {sheet === 'target' && <BottomSheet title="Мишень" onClose={() => setSheet(null)} tag="target-profile-sheet">
      <div className="target-profile-list">
        {TARGET_PROFILES.map(candidate => <button type="button" key={candidate.id} className="target-profile-option"
          data-testid={`target-profile-${candidate.id}`} aria-pressed={candidate.id === profileId} onClick={() => {
            setProfileId(candidate.id);
            markTouched('targetProfileId');
            if (!acceptsDiameter(candidate, mm)) {
              setDiameter(String((candidate.diameters[0] ?? mm) / 10));
              markTouched('targetDiameterMm');
            }
            setSheet(null);
          }}>
          <TargetPreview profileId={candidate.id} />
          <span><strong>{candidate.title}</strong><small>{candidate.diameters.length ? `${candidate.diameters.map(value => value / 10).join(' / ')} см` : 'Свой диаметр'}</small></span>
        </button>)}
      </div>
    </BottomSheet>}
    {sheet === 'round' && <BottomSheet title="Ограничение раунда" onClose={() => setSheet(null)} tag="conditions-options-sheet">
      <div className="round-options">
        <div className="inline-heading round-options-heading"><h3>Формат</h3><button type="button" className="help-icon" aria-label="О формате раунда" onClick={() => setHelp(true)}>?</button></div>
        <div className="condition-tabs" role="group" aria-label="Формат раунда">
          {(['arrows', 'series', 'unlimited'] as const).map(unit => <button type="button" key={unit}
            data-testid={unit === 'arrows' ? 'volume-arrows' : unit === 'series' ? 'volume-fixed' : 'volume-free'}
            aria-pressed={roundUnit === unit} onClick={() => {
              setRoundUnit(unit);
              if (unit === 'series') setRoundLimit('10');
              else if (unit === 'arrows') setRoundLimit('30');
            }}>{unit === 'arrows' ? 'Стрелы' : unit === 'series' ? 'Серии' : 'Без лимита'}</button>)}
        </div>
        {roundUnit !== 'unlimited' && <ConditionNumber title={roundUnit === 'arrows' ? 'Стрел в раунде' : 'Серий в раунде'}
          tag={roundUnit === 'arrows' ? 'round-arrows' : 'round-series'} value={roundLimit}
          choices={roundUnit === 'arrows' ? [30, 60, 72] : [6, 10, 12]} invalid={!isRoundRule(nextRule)} onChange={setRoundLimit} />}
        <button type="button" className="primary" data-testid="conditions-options-done" onClick={() => setSheet(null)}>Готово</button>
      </div>
    </BottomSheet>}
    {sheet === 'presets' && <BottomSheet title="Избранные условия" onClose={() => { setSheet(null); setError(''); }} tag="training-presets-sheet">
      <div className="preset-editor">
        {presetState.presets.length > 0 && <label className="condition-input"><span>Поиск</span><input aria-label="Поиск избранных условий" value={presetQuery} onChange={event => setPresetQuery(event.target.value)} /></label>}
        {presetState.presets.length === 0 && <p className="round-help">Сначала задай условия тренировки и сохрани их кнопкой «+».</p>}
        {presetState.presets.filter(preset => preset.name.toLocaleLowerCase('ru-RU').includes(presetQuery.trim().toLocaleLowerCase('ru-RU'))).map(preset => <div className="saved-preset" key={preset.id}>
          <button type="button" className="preset-choice" onClick={() => { if (selectPreset(preset)) setSheet(null); }}>
            <strong>{preset.name}</strong><small>{preset.conditions.distanceMeters} м · {preset.conditions.targetDiameterMm / 10} см · {ruleText(preset.rule)}</small>
          </button>
          <button type="button" className="icon-button" aria-label={`Удалить набор ${preset.name}`} onClick={() => setRemovingPreset(preset)}><Icon name="delete" /></button>
        </div>)}
        {error && <p className="conditions-error" role="alert">{error}</p>}
      </div>
    </BottomSheet>}
    {sheet === 'preset' && <BottomSheet title="Сохранить условия" onClose={() => { setSheet(null); setError(''); }}>
      <div className="preset-editor">
        <label className="condition-input"><span>Название</span><input autoFocus aria-label="Название набора" value={presetName} maxLength={60} onChange={event => setPresetName(event.target.value)} /></label>
        {error && <p className="conditions-error" role="alert">{error}</p>}
        <button type="button" className="primary" disabled={!presetName.trim() || !valid} onClick={writePreset}>Сохранить</button>
      </div>
    </BottomSheet>}
    {removingPreset && <BottomSheet title={`Удалить набор «${removingPreset.name}»?`} onClose={() => setRemovingPreset(null)}>
      <div className="confirm-actions"><button type="button" onClick={() => setRemovingPreset(null)}>Отмена</button>
        <button type="button" className="primary" onClick={() => { deletePreset(removingPreset.id); setRemovingPreset(null); }}>Удалить</button>
      </div>
    </BottomSheet>}
    {help && <BottomSheet title="О формате раунда" onClose={() => setHelp(false)}>
      <p className="round-help">По стрелам — вводи серии любой длины до лимита. После лимита кнопка «Следующий раунд» откроет первую серию нового раунда. По сериям — переход после выбранного числа серий. Без ограничения — начинай новый раунд вручную. Невнесённые стрелы не становятся промахами. Формат сохраняется для этой тренировки.</p>
    </BottomSheet>}
  </main>;
}
