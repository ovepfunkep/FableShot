import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import type { DiaryEntry } from './persistence.ts';
import { formatTrainingTime } from './training-time.ts';
import { Icon } from './TrainingChrome.tsx';
import { TechniqueWindow } from './TechniqueWindow.tsx';
import type { TechniquePublication } from './TechniqueWindow.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
import { bestRankResults } from './PersonalRanksScreen.tsx';
import { AssignedRanks } from './AssignedRanks.tsx';
import { ProfileAchievements } from './AchievementGallery.tsx';
import type { AchievementGrant } from './achievement-ledger.ts';
import { driveBackupAvailable, driveBackupState, signOutGoogle, subscribeDriveBackup } from './drive-backup.ts';
import { GoogleAccountButton } from './GoogleAccountButton.tsx';
import { ProfileAvatar } from './ProfileAvatar.tsx';
import { ChoicePicker } from './ChoicePicker.tsx';
import './profile-screen.css';

export function ProfileScreen({ entries, grants, onBack, onRanks, onAchievements, onAchievement, onPublication, onRecords, onNotebook, onTournaments, tournamentCount, focusRankCategory }: { entries: readonly DiaryEntry[];
  grants: readonly AchievementGrant[]; onBack: () => void; onRanks: () => void; onAchievements: () => void;
  onAchievement?: (id: 'APP08') => void; onPublication?: (publication: TechniquePublication) => void;
  onRecords: () => void;
  onNotebook: () => void;
  onTournaments: () => void;
  tournamentCount: number;
  focusRankCategory?: boolean;
}) {
  const { preferences, update, error } = useTrainingPreferences();
  const { account, connected } = useSyncExternalStore(subscribeDriveBackup, driveBackupState);
  const displayName = preferences.displayName || account?.name;
  const [panel, setPanel] = useState<'name' | 'time' | 'technique' | null>(null);
  const [name, setName] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [achievementError, setAchievementError] = useState('');
  const [accountError, setAccountError] = useState('');
  const categoryRow = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!focusRankCategory) return;
    categoryRow.current?.scrollIntoView({ block: 'center' });
    categoryRow.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [focusRankCategory]);
  const base = preferences.shootingBaseMinutes ?? 0;
  const showEarned = preferences.showAchievementNotices !== false;
  const recorded = entries.reduce((sum, item) => sum + (item.trainingTime?.closedMs ?? 0), 0);
  const arrows = entries.reduce((count, item) => count + item.practice.rounds.reduce((total, round) =>
    total + round.series.reduce((sum, series) => sum + series.shots.length, 0), 0), 0);
  const showNorms = statisticVisible(preferences, 'norms');
  const best = showNorms ? bestRankResults(entries, preferences.rankCategory ?? null) : [];
  const bestSummary = best.length > 1 ? `${best.length} формата` : best[0]
    ? best[0].evaluation.result?.label ?? `${best[0].evaluation.points} оч.` : '—';
  const nextBase = Number(hours) * 60 + Number(minutes);
  const timeValid = /^\d{0,6}$/.test(hours) && /^\d{0,2}$/.test(minutes) && Number(minutes) < 60 && nextBase <= 59_999_999;
  const formatMinutes = (ms: number) => ms < 60_000 ? '0 мин' : formatTrainingTime(ms);
  const editIcon = <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 16 12-12 4 4L8 20H4zm9-9 4 4" /></svg>;
  return <main className="conditions-page" data-testid="profile-screen">
    <header className="topbar"><button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button><h1>Профиль</h1></header>
    <div className="conditions-content profile-content">
      <section className="profile-panel profile-name">
        <ProfileAvatar picture={account?.picture} name={displayName} size={48} />
        <div><h2>{displayName || 'Мой профиль'}</h2>{account && <small>{connected ? 'Google подключён' : 'Аккаунт Google'}</small>}</div>
        <button type="button" className="icon-button" aria-label="Изменить имя" onClick={() => { setName(displayName ?? ''); setPanel('name'); }}>{editIcon}</button>
        {driveBackupAvailable && !connected && <GoogleAccountButton className="profile-account-button" label={account ? 'Подключить Google снова' : 'Войти через Google'} />}
        {driveBackupAvailable && account && <div className="profile-account-actions">
          {account && <button type="button" className="profile-account-button" onClick={() => {
            setAccountError('');
            try { signOutGoogle(); } catch { setAccountError('Не удалось отключить аккаунт Google.'); }
          }}>Выйти из Google</button>}
          {accountError && <p role="alert">{accountError}</p>}
        </div>}
      </section>
      {achievementError && <p role="alert">{achievementError}</p>}
      <button type="button" className="primary profile-primary" data-testid="profile-technique" onClick={() => setPanel('technique')}><Icon name="notes" />Моя техника</button>
      {statisticVisible(preferences, 'volume') && <div className="profile-metrics">
        <div className="profile-panel profile-metric"><Icon name="target" /><div><strong>{arrows}</strong><span>Стрел</span></div></div>
        <div className="profile-panel profile-metric"><Icon name="calendar" /><div><strong>{entries.length}</strong><span>Тренировок</span></div></div>
      </div>}
      <div className="profile-settings-row">
      {statisticVisible(preferences, 'training_time') && <div className="profile-panel profile-metric">
          <Icon name="timer" />
          <div><strong data-testid="shooting-hours-total">{formatMinutes(base * 60_000 + recorded)}</strong><span>Часы стрельбы</span></div>
          <button type="button" className="icon-button" aria-label="Изменить базу часов стрельбы" onClick={() => {
            setHours(String(Math.floor(base / 60))); setMinutes(String(base % 60)); setPanel('time');
          }}>{editIcon}</button>
      </div>}
      <div className="profile-panel profile-rank-category" ref={categoryRow} role="group" aria-label="Пол для нормативов">
        <span>Пол для нормативов</span>
        <ChoicePicker label="Пол для нормативов" value={preferences.rankCategory ?? ''}
          options={[{ value: 'male', label: 'Мужской' }, { value: 'female', label: 'Женский' }, { value: '', label: 'Не указан' }]}
          onChange={value => void update({ ...preferences, rankCategory: value === 'male' || value === 'female' ? value : undefined })} />
      </div>
      </div>
      {showNorms && <><AssignedRanks assignments={preferences.rankAssignments ?? []} defaultCategory={preferences.rankCategory}
        onChange={rankAssignments => update({ ...preferences, rankAssignments })} />
        <button type="button" className="profile-panel profile-metric" data-testid="profile-rank-results" onClick={onRanks}>
          <Icon name="podium" /><div><strong>{bestSummary}</strong><span>Лучшие по нормативам</span></div><Icon name="right" />
        </button>
      </>}
      {statisticVisible(preferences, 'records') && <button type="button" className="primary profile-primary"
        data-testid="profile-personal-records" onClick={onRecords}><Icon name="stats" />Мои рекорды</button>}
      <ProfileAchievements grants={grants} showEarned={showEarned} onOpen={onAchievements} />
      <button type="button" className="profile-panel profile-metric" onClick={onTournaments}>
        <Icon name="trophy" /><div><strong>{tournamentCount}</strong><span>Турниры</span></div><Icon name="right" />
      </button>
      <button type="button" className="profile-panel profile-notebook" data-testid="profile-notebook" onClick={onNotebook}>
        <Icon name="notes" />Заметки<Icon name="right" />
      </button>
    </div>
    {panel === 'technique' && <TechniqueWindow initial={null} onPublication={onPublication} onClose={() => setPanel(null)} />}
    {panel === 'name' && <BottomSheet title="Имя" onClose={() => setPanel(null)}>
      <form className="profile-form" onSubmit={async event => {
        event.preventDefault();
        setAchievementError('');
        const displayName = name.trim();
        if (!await update({ ...preferences, displayName })) return;
        setPanel(null);
        if (displayName) {
          try { onAchievement?.('APP08'); }
          catch (cause) { setAchievementError(`Имя сохранено. ${cause instanceof Error ? cause.message : 'Не удалось сохранить достижение.'}`); }
        }
      }}>
        <label>Имя<input maxLength={40} value={name} onChange={event => setName(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}<button type="submit" className="primary">Сохранить</button>
      </form>
    </BottomSheet>}
    {panel === 'time' && <BottomSheet title="Часы стрельбы" onClose={() => setPanel(null)}>
      <p>Учтено в дневнике · {formatMinutes(recorded)}</p>
      <p>Добавь время, которое было до FableShot.</p>
      <form className="profile-form" onSubmit={async event => {
        event.preventDefault(); if (timeValid && await update({ ...preferences, shootingBaseMinutes: nextBase })) setPanel(null);
      }}>
        <div className="profile-metrics">
          <label>Часы<input inputMode="numeric" maxLength={6} value={hours} onChange={event => setHours(event.target.value)} /></label>
          <label>Минуты<input inputMode="numeric" maxLength={2} value={minutes} onChange={event => setMinutes(event.target.value)} /></label>
        </div>
        {error && <p role="alert">{error}</p>}<button type="submit" className="primary" disabled={!timeValid}>Сохранить</button>
      </form>
    </BottomSheet>}
  </main>;
}
