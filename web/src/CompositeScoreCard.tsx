import { useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import type { Practice } from './practice.ts';
import type { Conditions } from './conditions.ts';
import {
  calculateCompositeScore, conditionsKey, displayCompositeScore, displayGroupRms, practiceCompositeGroups, SCORE_ONLY_PROFILE, STANDARD_PROFILE,
} from './composite-scoring.ts';
import type { CompositeProfile, CompositeScore } from './composite-scoring.ts';
import './composite-score.css';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';

type Group = ReturnType<typeof practiceCompositeGroups>[number];
const reasons: Record<Exclude<CompositeScore['availability'], 'available'>, string> = {
  'no-data': 'Нет полных серий в выбранном срезе.',
  'incomplete-slice': 'Для выбранной серии пока внесены не все результаты.',
  'incomplete-end': 'Среди выбранных есть открытая или неполная серия.',
  'insufficient-end-shots': 'Чтобы оценить кучность, в каждой выбранной серии должны быть хотя бы 3 стрелы.',
  'insufficient-ends': 'Чтобы оценить стабильность, нужны минимум 3 полностью заполненные серии и 9 стрел.',
  'missing-coordinates': 'Для расчёта кучности нужны отметки всех попаданий. Если вводишь только числа, выбери «Попадания + стабильность».',
  'unverified-geometry': 'Для этой мишени геометрия ещё не проверена. Выбери «Попадания + стабильность».',
  'unknown-maximum': 'Правила мишени и максимум стрелы ещё не определены.',
  'invalid-data': 'Проверь оценки, координаты и порядок стрел в этом срезе.',
};

function Component({ label, value, maximum }: { label: string; value: number; maximum: number }) {
  return <div className="cg3-component">
    <div><span>{label}</span><strong>{displayCompositeScore(value)} / {maximum}</strong></div>
    <progress aria-label={label} value={value} max={maximum} />
  </div>;
}

function ScoreHelp({ group, profile, score, onClose }: { group: Group; profile: CompositeProfile; score: CompositeScore; onClose: () => void }) {
  const standard = profile === STANDARD_PROFILE;
  return <BottomSheet title="Как считаются общие очки" tag="cg3-help-sheet" onClose={onClose}>
    <div className="cg3-help">
      <p>{standard
        ? 'Это очки за попадания плюс небольшие надбавки за близкие друг к другу стрелы и стабильные результаты серий. Максимум — 105.'
        : 'Здесь к очкам за попадания добавляется надбавка за стабильные результаты серий. Отметки на мишени для этого профиля не нужны. Максимум — 105.'}</p>
      <p>В расчёт входят полностью внесённые серии, в том числе текущая, если в ней записаны все стрелы. Серия начинается с плана на три стрелы и расширяется при записи дополнительных. Если удалить стрелу, её место остаётся в плане.</p>
      <p>В выбранном срезе {score.endCount} полных серий · {score.shotCount} стрел · {score.knownPositions} отметок на мишени.</p>
      {score.base !== undefined && <p>За попадания получено {score.classic} из {score.maximum} возможных. Чтобы сравнивать серии с разным числом стрел, переводим это в {displayCompositeScore(score.base)} из 100.</p>}
      {standard && <p>Чем ближе отмеченные стрелы друг к другу внутри каждой серии, тем больше надбавка. Промах без отметки даёт ноль очков. Для оценки кучности нужны хотя бы две отметки в одной серии.</p>}
      <p>Чем меньше меняется средний балл от серии к серии, тем больше надбавка за стабильность. Для неё нужны минимум 3 полные серии и 9 стрел.</p>
      <details className="cg3-disclosure">
        <summary data-testid="cg3-explain">Формулы и точные правила</summary>
        <div className="cg3-help" data-testid="cg3-formula">
          <h4>Точная формула CG3</h4>
          <strong>{!standard ? 'G = 100A + 5T' : score.phase === 'full' ? 'G = 100A + 4Q + T' : 'E = 100A + 5Q'}</strong>
          <p>A — доля от максимума. {standard && 'Q — кучность внутри каждой серии, clamp(1 − RMS / 0,10 R). '}T — повторяемость средних серий, clamp(1 − SD / 0,15). Максимальный общий бонус — 5.</p>
          {score.rms !== undefined && <p>RMS · {displayGroupRms(score.rms)} R · {displayCompositeScore(score.rms * group.conditions.targetDiameterMm / 2)} мм</p>}
          {score.q !== undefined && <p>Q · {displayCompositeScore(score.q)}</p>}
          {score.stability !== undefined && <p>T · {displayCompositeScore(score.stability)}</p>}
          {score.rawEquivalent !== undefined && <p>Эквивалент в очках этого объёма · {displayCompositeScore(score.rawEquivalent)}</p>}
          <p>Итог округляется отдельно от компонентов. Их показанная сумма может отличаться на 0,01.</p>
          <small>{profile}</small>
        </div>
      </details>
    </div>
  </BottomSheet>;
}

function GroupScore({ group }: { group: Group }) {
  const { preferences } = useTrainingPreferences();
  const [profile, setProfile] = useState<CompositeProfile>(STANDARD_PROFILE);
  const [single, setSingle] = useState(false);
  const [requestedSlice, setRequestedSlice] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const slice = group.ends.find(end => String(end.id) === requestedSlice)?.number ?? group.ends.length;
  const score = useMemo(() => calculateCompositeScore(group.ends, slice, group.maximumPerArrow, group.geometryVerified, profile, single),
    [group, slice, profile, single]);
  return <>
    <header className="cg3-heading">
      <h3>Общие очки</h3>
      <button type="button" className="training-mean-help" data-testid="cg3-help"
        aria-label="Как считаются общие очки" onClick={() => setHelpOpen(true)}>?</button>
    </header>
    <details className="cg3-disclosure">
      <summary data-testid="cg3-controls">Настроить общие очки</summary>
      <div className="cg3-fields">
        <label>Профиль расчёта
          <select data-testid="cg3-profile" value={profile} onChange={event => setProfile(event.currentTarget.value === SCORE_ONLY_PROFILE ? SCORE_ONLY_PROFILE : STANDARD_PROFILE)}>
            <option value={STANDARD_PROFILE} data-testid="cg3-profile-Standard">Попадания + кучность + стабильность</option>
            <option value={SCORE_ONLY_PROFILE} data-testid="cg3-profile-ScoreOnly">Попадания + стабильность</option>
          </select>
        </label>
        <label>Срез
          <select data-testid="cg3-scope" value={single ? 'single' : 'cumulative'} onChange={event => setSingle(event.currentTarget.value === 'single')}>
            <option value="cumulative" data-testid="cg3-cumulative">Итог до серии</option>
            <option value="single" data-testid="cg3-single">За серию</option>
          </select>
        </label>
        <label>Серия
          <select data-testid="cg3-slice" value={group.ends[slice - 1].id} onChange={event => setRequestedSlice(event.currentTarget.value)}>
            {group.ends.map(end => <option key={end.id} value={end.id} data-testid={`cg3-slice-${end.number}`}>
              Раунд {end.roundNumber} · серия {end.seriesNumber}
            </option>)}
          </select>
        </label>
      </div>
    </details>
    <div className="cg3-result"><strong data-testid="cg3-total">{score.total === undefined ? '—' : displayCompositeScore(score.total)}</strong><span>/ 105</span></div>
    {score.availability === 'available' ? <>
      {score.phase === 'early' && <p className="cg3-note" data-testid="cg3-phase">Предварительно · пока без стабильности</p>}
      {score.phase === 'single' && <p className="cg3-note" data-testid="cg3-phase">Отдельная серия · короткая выборка</p>}
      {score.base !== undefined && <Component label="За попадания" value={score.base} maximum={100} />}
      {statisticVisible(preferences, 'grouping') && score.groupBonus !== undefined && <Component label="Бонус за кучность" value={score.groupBonus} maximum={score.phase === 'full' ? 4 : 5} />}
      {statisticVisible(preferences, 'stability') && score.stabilityBonus !== undefined && <Component label="Бонус за стабильность серий" value={score.stabilityBonus} maximum={profile === SCORE_ONLY_PROFILE ? 5 : 1} />}
    </> : <p className="cg3-note" data-testid="cg3-reason">{reasons[score.availability]}</p>}
    {helpOpen && <ScoreHelp group={group} profile={profile} score={score} onClose={() => setHelpOpen(false)} />}
  </>;
}

export function CompositeScoreCard({ practice, conditions }: { practice: Practice; conditions: Conditions }) {
  const groups = useMemo(() => practiceCompositeGroups(practice), [practice]);
  const key = conditionsKey(conditions);
  const group = groups.find(candidate => candidate.key === key);
  if (!group) return null;
  return <section className="cg3-card" data-testid="cg3-card" aria-label="Общие очки">
    <GroupScore key={group.key} group={group} />
  </section>;
}
