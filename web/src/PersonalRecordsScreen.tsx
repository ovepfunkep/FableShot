import { ChoicePicker } from './ChoicePicker.tsx';
import { useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { personalRecordGroups } from './personal-record-events.ts';
import type { PersonalRecordGroup, PersonalRecordScope } from './personal-record-events.ts';
import { BOW_CATEGORIES } from './equipment.ts';
import type { DiaryEntry } from './persistence.ts';
import { formatAverage } from './preferences.ts';
import { statisticVisible } from './statistics-visibility.ts';
import { Icon } from './TrainingChrome.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './personal-records-screen.css';

type Props = {
  entries: readonly DiaryEntry[];
  onBack: () => void;
  onOpen: (id: string) => void;
  onRanks: () => void;
};

const measure = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3, useGrouping: false });
const help = {
  series: {
    title: 'Сопоставимые серии',
    text: 'Сравниваются полные зачётные серии с одинаковой дистанцией, мишенью и числом стрел в выбранном зачёте. При исправлении или удалении тренировки рекорд пересчитывается. При равных очках лидирует более ранний результат.',
  },
  volume: {
    title: 'Рекорд объёма',
    text: 'Самое большое число записанных стрел за одну завершённую тренировку. При равном объёме первым остаётся более ранний результат.',
  },
  round: {
    title: 'Сопоставимые раунды',
    text: 'Учитываются раунды завершённых тренировок, которые набрали заданное число стрел или полных серий. Сравниваются одинаковые лимиты, объём, мишень и дистанция в выбранном зачёте.',
  },
};

function displayDate(value: string | null) {
  return value ? value.split('-').reverse().join('.') : 'Дата не указана';
}

export function PersonalRecordsScreen({ entries, onBack, onOpen, onRanks }: Props) {
  const { preferences } = useTrainingPreferences();
  const [tab, setTab] = useState<keyof typeof help>('series');
  const [search, setSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [scope, setScope] = useState<PersonalRecordScope>('all');
  const [filter, setFilter] = useState('');
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const groups = useMemo(() => personalRecordGroups(entries, tab, scope), [entries, tab, scope]);
  const history = groups.find(group => group.key === historyKey);
  const scopeChoices = new Map(groups.map(group => [group.scopeKey, group.scopeLabel]));
  const query = search.trim().toLocaleLowerCase('ru-RU').replace(/(\d)\.(?=\d)/g, '$1,');
  const bow = (category?: string | null) => BOW_CATEGORIES.find(item => item.value === category)?.label;
  const visible = groups.filter(group => (!filter || group.scopeKey === filter) && (tab === 'volume' || !query || matchesScore(group)));
  function matchesScore(group: PersonalRecordGroup) {
    const record = group.leader.display!;
    return [measure.format(record.conditions.distanceMeters),
    measure.format(record.conditions.targetDiameterMm / 10), record.arrows, record.targetTitle, record.equipmentTitle,
    bow(record.conditions.equipment?.bow.category)]
      .join(' ').toLocaleLowerCase('ru-RU').includes(query);
  }
  const showMean = statisticVisible(preferences, 'average');
  return <main className="conditions-page" data-testid="personal-records-screen">
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button>
      <h1>Личные рекорды</h1>
    </header>
    <div className="conditions-content personal-records-content">
      {statisticVisible(preferences, 'norms') && <button type="button" className="primary personal-records-ranks" data-testid="records-ranks" onClick={onRanks}>
        <Icon name="stats" />Лучшие по нормативам
      </button>}
      <div className="personal-records-tabs" role="group" aria-label="Зачёт рекорда">
        {(['all', 'bow', 'kit'] as const).map(item => <button type="button" key={item} aria-pressed={item === scope}
          onClick={() => { setScope(item); setFilter(''); }}>{{ all: 'Общий', bow: 'Класс', kit: 'Комплект' }[item]}</button>)}
      </div>
      {scope !== 'all' && <ChoicePicker label={scope === 'kit' ? 'Комплект рекорда' : 'Класс рекорда'}
        value={scopeChoices.has(filter) ? filter : ''} onChange={setFilter}
        options={[{ value: '', label: scope === 'kit' ? 'Все комплекты' : 'Все классы' },
          ...[...scopeChoices].map(([value, label]) => ({ value, label }))]} />}
      <div className="personal-records-tabs" role="group" aria-label="Тип рекорда">
        <button type="button" data-testid="records-series" aria-pressed={tab === 'series'} onClick={() => { setTab('series'); setFilter(''); }}>Серии</button>
        <button type="button" data-testid="records-rounds" aria-pressed={tab === 'round'} onClick={() => { setTab('round'); setFilter(''); }}>Раунды</button>
        <button type="button" data-testid="records-volume" aria-pressed={tab === 'volume'} onClick={() => { setTab('volume'); setFilter(''); }}>Объём</button>
      </div>
      <header className="personal-records-heading">
        <h2>{{ series: 'Лучшие полные серии', round: 'Лучшие полные раунды', volume: 'Объём за тренировку' }[tab]}</h2>
        <button type="button" className="personal-records-help" aria-label={help[tab].title} onClick={() => setHelpOpen(true)}>?</button>
      </header>
      {tab !== 'volume' && <>
        <label className="personal-records-search">
          Дистанция, мишень, лук, комплект
          <input type="search" value={search} data-testid="records-search" onChange={event => setSearch(event.target.value)} />
        </label>
      </>}
      {!visible.length && <p className="personal-records-empty" role="status">{query && tab !== 'volume' ? 'Ничего не найдено' :
        tab === 'volume' ? 'Рекорд объёма появится после завершения непустой тренировки.' :
        tab === 'round' ? 'Нет подходящих полных раундов' : 'Нет подходящих полных серий'}</p>}
      {visible.map(group => {
        const { leader } = group;
        const record = leader.display;
        const id = record ? `${tab}-record-${leader.sessionId}-${leader.stageId}` : 'volume-record';
        return <div className="personal-records-entry" key={group.key}>
          <button type="button" className="personal-records-card" data-testid={id} onClick={() => onOpen(leader.sessionId)}>
          <span className="personal-records-numbers">
            <strong>{record ? `${record.points}/${record.maximum}` : leader.value}</strong>
            {record ? showMean && <span>Ср. {formatAverage(record.points / record.arrows, preferences.averageHundredths)}</span> : <span>стрел</span>}
          </span>
          {record && <span className="personal-records-conditions">{measure.format(record.conditions.distanceMeters)} м · {measure.format(record.conditions.targetDiameterMm / 10)} см · {'format' in record ? record.format : `${record.arrows} стрел`}</span>}
          <span className="personal-records-meta">{record ? [record.targetTitle, bow(record.conditions.equipment?.bow.category), record.equipmentTitle].filter(Boolean).join(' · ')
            : entries.find(entry => entry.id === leader.sessionId)?.title || 'Тренировка'}</span>
          <span className="personal-records-meta">{displayDate(leader.date)}{record && ` · Раунд ${record.roundNumber}${'seriesNumber' in record ? ` · Серия ${record.seriesNumber}` : ''}`}</span>
          {scope !== 'all' && <span className="personal-records-meta">{group.scopeLabel}</span>}
          <Icon name="right" />
          </button>
          <button type="button" className="text-action personal-records-history-open" onClick={() => setHistoryKey(group.key)}>История</button>
        </div>;
      })}
    </div>
    {helpOpen && <BottomSheet title={help[tab].title} tag="personal-records-help" onClose={() => setHelpOpen(false)}>
      <p>{help[tab].text}</p>
    </BottomSheet>}
    {history && <BottomSheet title="История рекорда" tag="personal-records-history" onClose={() => setHistoryKey(null)}>
      <p>{history.scopeLabel} · По дневнику</p>
      <div className="personal-records-history">
        {[...history.history].reverse().map((source, index) => {
          const former = history.history.at(-index - 2);
          return <button type="button" key={`${source.sessionId}:${source.stageId}`} onClick={() => { setHistoryKey(null); onOpen(source.sessionId); }}>
            <span>{displayDate(source.date)}</span>
            <strong>{former && `${former.value} → `}{source.value}</strong><Icon name="right" />
          </button>;
        })}
        {history.history.length === 0 && <p>Для хронологии нужна дата тренировки.</p>}
      </div>
    </BottomSheet>}
  </main>;
}
