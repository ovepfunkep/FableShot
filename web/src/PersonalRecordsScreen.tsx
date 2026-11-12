import { useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { personalSeriesRecords, personalVolumeRecord } from './personal-record-events.ts';
import type { DiaryEntry } from './persistence.ts';
import { formatAverage } from './preferences.ts';
import { timelineDate } from './progress-timeline.ts';
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
    text: 'Сравниваются полные зачётные серии завершённых тренировок с одинаковой дистанцией, мишенью, снаряжением и числом стрел. При исправлении или удалении тренировки рекорд пересчитывается. Равные очки сохраняют первый результат.',
  },
  volume: {
    title: 'Рекорд объёма',
    text: 'Самое большое число записанных стрел за одну завершённую тренировку. При равном объёме первым остаётся более ранний результат.',
  },
};

function displayDate(value: string | null) {
  return value ? value.split('-').reverse().join('.') : 'Дата не указана';
}

export function PersonalRecordsScreen({ entries, onBack, onOpen, onRanks }: Props) {
  const { preferences } = useTrainingPreferences();
  const [tab, setTab] = useState<'series' | 'volume'>('series');
  const [search, setSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const records = useMemo(() => personalSeriesRecords(entries), [entries]);
  const volume = useMemo(() => personalVolumeRecord(entries), [entries]);
  const query = search.trim().toLocaleLowerCase('ru-RU').replace(/(\d)\.(?=\d)/g, '$1,');
  const visible = records.filter(record => [measure.format(record.conditions.distanceMeters),
    measure.format(record.conditions.targetDiameterMm / 10), record.arrows, record.targetTitle, record.equipmentTitle]
    .join(' ').toLocaleLowerCase('ru-RU').includes(query));
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
      <div className="personal-records-tabs" role="group" aria-label="Тип рекорда">
        <button type="button" data-testid="records-series" aria-pressed={tab === 'series'} onClick={() => setTab('series')}>Серии</button>
        <button type="button" data-testid="records-volume" aria-pressed={tab === 'volume'} onClick={() => setTab('volume')}>Объём</button>
      </div>
      <header className="personal-records-heading">
        <h2>{tab === 'series' ? 'Лучшие полные серии' : 'Объём за тренировку'}</h2>
        <button type="button" className="personal-records-help" aria-label={help[tab].title} onClick={() => setHelpOpen(true)}>?</button>
      </header>
      {tab === 'volume' ? volume ? <button type="button" className="personal-records-card" data-testid="volume-record" onClick={() => onOpen(volume.entry.id)}>
        <span className="personal-records-numbers"><strong>{volume.count}</strong><span>стрел</span></span>
        <span className="personal-records-meta">{volume.entry.title || 'Тренировка'} · {displayDate(timelineDate(volume.entry))}</span>
        <Icon name="right" />
      </button> : <p className="personal-records-empty" role="status">Рекорд объёма появится после завершения непустой тренировки.</p> : <>
        <label className="personal-records-search">
          Дистанция, мишень, комплект
          <input type="search" value={search} data-testid="records-search" onChange={event => setSearch(event.target.value)} />
        </label>
        {!visible.length && <p className="personal-records-empty" role="status">{query ? 'Ничего не найдено' : 'Нет подходящих полных серий'}</p>}
        {visible.map(record => <button type="button" className="personal-records-card" key={`${record.sessionId}:${record.seriesId}`}
          data-testid={`series-record-${record.sessionId}-${record.seriesId}`} onClick={() => onOpen(record.sessionId)}>
          <span className="personal-records-numbers">
            <strong>{record.points}/{record.maximum}</strong>
            {showMean && <span>Ср. {formatAverage(record.points / record.arrows, preferences.averageHundredths)}</span>}
          </span>
          <span className="personal-records-conditions">{measure.format(record.conditions.distanceMeters)} м · {measure.format(record.conditions.targetDiameterMm / 10)} см · {record.arrows} стрел</span>
          <span className="personal-records-meta">{record.targetTitle} · {record.equipmentTitle}</span>
          <span className="personal-records-meta">{displayDate(record.date)} · Раунд {record.roundNumber} · Серия {record.seriesNumber}</span>
          <Icon name="right" />
        </button>)}
      </>}
    </div>
    {helpOpen && <BottomSheet title={help[tab].title} tag="personal-records-help" onClose={() => setHelpOpen(false)}>
      <p>{help[tab].text}</p>
    </BottomSheet>}
  </main>;
}
