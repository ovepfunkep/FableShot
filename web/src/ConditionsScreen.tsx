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
import './conditions.css';

export function BottomSheet({ title, onClose, children, tag }: {
  title: string; onClose: () => void; children: ReactNode; tag?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<number | null>(null);
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="condition-sheet" aria-label={title} data-testid={tag}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="condition-sheet-body">
      <header onPointerDown={event => { drag.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={event => {
          if (drag.current !== null && event.clientY - drag.current > 65) onClose();
          drag.current = null;
        }}>
        <span className="sheet-handle" aria-hidden="true" />
        <h2>{title}</h2>
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

export function ConditionsScreen({ initial, rule, editableRule, initialNumbering, onApply, onBack, onTechnique, techniqueTitle, tournaments }: {
  initial: Conditions; rule: RoundRule; editableRule: boolean;
  initialNumbering: boolean | null;
  onApply: (conditions: Conditions, rule: RoundRule, numberedArrows: boolean | null, tournament?: TournamentChoice) => boolean; onBack: () => void;
  tournaments?: readonly Tournament[];
  onTechnique: () => void; techniqueTitle: string;
}) {
  const [distance, setDistance] = useState(String(initial.distanceMeters));
  const [diameter, setDiameter] = useState(String(initial.targetDiameterMm / 10));
  const [profileId, setProfileId] = useState(initial.targetProfileId);
  const [equipment, setEquipment] = useState(initial.equipment);
  const [numberedArrows, setNumberedArrows] = useState(initialNumbering);
  const [tournamentKey, setTournamentKey] = useState('');
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

  function writePreset() {
    try {
      const presets = savePreset(presetName.trim(), nextConditions, nextRule, numberedArrows);
      setPresetState({ presets, error: '' });
      setPresetName('');
      setError('');
      setSheet(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить избранное.'); }
  }

  function deletePreset(id: string) {
    try {
      setPresetState({ presets: removePreset(id), error: '' });
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить набор.'); }
  }

  return <main className="conditions-page" data-testid="journal-setup">
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button>
      <h1>Условия тренировки</h1>
    </header>
    <div className="conditions-content">
      <div className="preset-strip" aria-label="Избранные условия">
        <button type="button" className="preset-open" data-testid="training-presets" onClick={() => { setError(''); setSheet('presets'); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" /></svg>
          Избранные условия
        </button>
        <button type="button" className="icon-button preset-add" aria-label="Сохранить условия в избранное" disabled={!valid || !!presetState.error}
          onClick={() => { setError(''); setSheet('preset'); }}>+</button>
      </div>
      {presetState.error && <p className="conditions-error" role="alert">{presetState.error}</p>}
      <div className="condition-number-grid">
        <ConditionNumber title="Дистанция" unit="м" tag="distance" value={distance} choices={[10, 18, 30]}
          invalid={!distanceValid} onChange={setDistance} />
        <ConditionNumber title="Диаметр" unit="см" tag="diameter" value={diameter} choices={profile.diameters.length ? profile.diameters.slice(0, 3).map(value => value / 10) : [40, 60, 80]}
          invalid={!diameterValid} onChange={setDiameter} />
      </div>
      <ConditionRow title="Мишень" value={profile.title} icon="target" tag="target-profile-choice" onClick={() => setSheet('target')} />
      <ConditionRow title="Комплект" value={equipment?.name ?? 'Без комплекта'} icon="kit" tag="conditions-equipment"
        onClick={() => { setEditEquipment(false); setSheet('equipment'); }}
        onEdit={equipment ? () => { setEditEquipment(true); setSheet('equipment'); } : undefined} />
      <ConditionRow title="Раунд" value={ruleText(nextRule)} icon="round" tag="conditions-options"
        onClick={editableRule ? () => setSheet('round') : undefined} />
      <details className="conditions-advanced">
        <summary data-testid="conditions-advanced"><Icon name="settings" /><span>Дополнительно</span><Icon name="right" /></summary>
        <div className="conditions-advanced-content">
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
            <TrainingPreferenceControls />
          </div>
        </div>
      </details>
      {error && <p className="conditions-error" role="alert">{error}</p>}
    </div>
    <footer className="conditions-footer">
      <button type="button" className="primary" data-testid="start-training" disabled={!valid} onClick={() => {
        if (tournamentKey && !tournamentChoice) { setError('Этот турнирный старт больше недоступен. Выбери другой.'); return; }
        if (!onApply(nextConditions, nextRule, numberedArrows, tournamentChoice)) setError('Не удалось применить условия. Повтори действие.');
      }}>{editableRule ? 'Начать тренировку' : 'Применить условия'}</button>
    </footer>
    {sheet === 'equipment' && <EquipmentPicker selected={equipment} onSelect={setEquipment} onClose={() => setSheet(null)} editSelected={editEquipment} />}
    {sheet === 'target' && <BottomSheet title="Мишень" onClose={() => setSheet(null)} tag="target-profile-sheet">
      <div className="target-profile-list">
        {TARGET_PROFILES.map(candidate => <button type="button" key={candidate.id} className="target-profile-option"
          data-testid={`target-profile-${candidate.id}`} aria-pressed={candidate.id === profileId} onClick={() => {
            setProfileId(candidate.id);
            if (!acceptsDiameter(candidate, mm)) setDiameter(String((candidate.diameters[0] ?? mm) / 10));
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
      <p className="round-help">По стрелам — вводи серии любой длины до лимита. Затем нажми «Следующий раунд». По сериям — переход после выбранного числа серий. Без ограничения — начинай новый раунд вручную. Невнесённые стрелы не становятся промахами. Формат сохраняется для этой тренировки.</p>
    </BottomSheet>}
  </main>;
}
