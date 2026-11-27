import { lazy, StrictMode, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { AndroidUpdateCard } from './AndroidUpdateCard.tsx';
import { useAndroidUpdates } from './android-updates.ts';
import { createRoot } from 'react-dom/client';
import { useAppBack } from './app-back.ts';
import { captureReportPosition, ReportOverview } from './ReportOverview.tsx';
import type { ReportPosition } from './ReportOverview.tsx';
import { BottomSheet, ConditionsScreen } from './ConditionsScreen.tsx';
import { PracticeTimerBadge, PracticeTimerWindow } from './PracticeTimerWindow.tsx';
import { usePracticeTimer } from './usePracticeTimer.ts';
import { performTrainingHaptic } from './native-training-window.ts';
import { LensControls, RecentPracticeLimitControl, TrainingPreferenceControls, TrainingPreferencesProvider, useTrainingPreferences, useKeepScreenOn } from './TrainingPreferences.tsx';
import type { CleanSeriesMotion, ShotMotionEvent } from './ShotMotion.tsx';
import { SHOT_FEEDBACK_MS } from './ShotMotion.tsx';
import { supportsAppScale } from './native-app-scale.ts';
import { TechniqueWindow } from './TechniqueWindow.tsx';
import type { TechniqueSelection } from './technique.ts';
import { TechniqueSettingsProvider } from './TechniqueSettings.tsx';
import { StagePicker } from './StagePicker.tsx';
import { LensTestTarget, TargetBoard } from './TargetBoard.tsx';
import { TargetGuide } from './TargetGuide.tsx';
import { TripleTargetControls } from './TripleTargetControls.tsx';
import { Icon, shotStripCapacity, TrainingFooter, TrainingShotStrip, TrainingSummary } from './TrainingChrome.tsx';
import { JournalHome, JournalShell } from './JournalShell.tsx';
import type { JournalTab } from './JournalShell.tsx';
import { defaultProgressView, JournalHistory, JournalProgress } from './JournalTabs.tsx';
import { TournamentsScreen } from './TournamentsScreen.tsx';
import { finishTournament, linkTournamentSession, saveTournament, unlinkTournamentSession } from './tournaments.ts';
import type { TournamentChoice } from './tournaments.ts';
import { EquipmentCatalog } from './EquipmentCatalog.tsx';
import { ProfileScreen } from './ProfileScreen.tsx';
import { WebReleaseNotes } from './WebReleaseNotes.tsx';
import { AboutScreen } from './AboutScreen.tsx';
import { ReleasePushSettings } from './ReleasePushSettings.tsx';
import { releasePush, releasePushSupported } from './release-push.ts';
import { WebOnboarding } from './WebOnboarding.tsx';
import type { OnboardingChapter } from './WebOnboarding.tsx';
import { WebThemeSettings } from './WebThemeSettings.tsx';
import { SettingsAction, SettingsScreen } from './SettingsScreen.tsx';
import type { SettingsSection } from './SettingsScreen.tsx';
import { AchievementGallery } from './AchievementGallery.tsx';
import { AchievementNotice } from './AchievementNotices.tsx';
import { PersonalRecordNotice } from './PersonalRecordCard.tsx';
import { PersonalRecordsScreen } from './PersonalRecordsScreen.tsx';
import { PersonalRanksScreen } from './PersonalRanksScreen.tsx';
import { calculatePersonalRecordEvents } from './personal-record-events.ts';
import type { PersonalRecordEvent } from './personal-record-events.ts';
import { hasFinishedCleanSeries, trainingMoment } from './training-moments.ts';
import type { TrainingMoment } from './training-moments.ts';
import { achievementReceiptKey, groupAchievementGrants, recentAchievementNotices } from './achievement-ledger.ts';
import type { AchievementGrant, AchievementMoment } from './achievement-ledger.ts';
import { ACHIEVEMENT_ACTION_RULE_IDS, awardPublication, awardServiceAction, awardTrainingChange, eligibleForAchievements } from './achievement-diary.ts';
import type { AchievementActionId } from './achievement-diary.ts';
import { achievementValidity, dependsOnTraining, removeAchievementEvidence } from './achievement-validity.ts';
import { reconcileConditionsCorrection, refreshCorrectedProgress } from './conditions-correction-results.ts';
import { ACHIEVEMENT_EVIDENCE_RULE_IDS, evaluateAchievementEvidence } from './achievement-evidence.ts';
import { STAGE_RANK_RULES } from './achievement-catalog.ts';
import { STAGE_RANK_ENROLLMENT_VERSION } from './stage-rank-achievements.ts';
import { DiaryNotesSheet } from './DiaryNotesSheet.tsx';
import { NotebookScreen } from './NotebookScreen.tsx';
import type { DiaryNoteScope } from './diary-notes.ts';
import { compareDiaryDate, DEFAULT_HISTORY_FILTERS, frequentTrainingTitles, renameDiaryEntry, setDiaryDeleted } from './diary-history.ts';
import { startTrainingTime, stopTrainingTime } from './training-time.ts';
import { equipmentSnapshot, loadEquipment } from './equipment.ts';
import { PhysicalArrowPicker } from './PhysicalArrowPicker.tsx';
import { RankDetails, RankReference, RankTag } from './SportRanks.tsx';
import { roundRank, seriesRank } from './sport-ranks.ts';
import { freezeProgressBaseline } from './progress-scoring.ts';
import { StatisticsSettings } from './StatisticsSettings.tsx';
import { ArchiveScreen } from './ArchiveScreen.tsx';
import { MyTargetsImport, MyTargetsImportReceipt, clearImportReceipt, readImportReceipt } from './MyTargetsImport.tsx';
import { withStorageOwner } from './storage-owner.ts';
import { statisticVisible } from './statistics-visibility.ts';
import { enableOffline } from './offline.ts';
import { initializeAppStorage, onJournalCommit } from './app-storage.ts';
import { driveBackupAvailable, driveBackupState, resumeDriveBackup, scheduleDriveBackup, subscribeDriveBackup } from './drive-backup.ts';
import { isDiary, loadDiary, saveDiary, sendPendingGroupSeries, updateGroupSeriesInDiary } from './persistence.ts';
import { newGroupSeriesJournal, pendingGroupSeries } from './group-series.ts';
import { announceRoomEntry, finishRoomTraining, loadRoomMembership, readRoomName, roomBridge, roomSnapshot, roomTransport, saveRoomMembership, supportsLocalRoom } from './group-room-membership.ts';
import { readRoomHistory } from './group-leaderboard.ts';
import type { RoomHistory } from './group-leaderboard.ts';
import { awardRoomAchievements, ROOM_ACHIEVEMENT_IDS } from './room-achievements.ts';
import type { RoomMembership } from './group-room-membership.ts';
import { GroupLeaderboard } from './GroupLeaderboard.tsx';
import { RoomHelp, RoomHelpButton } from './RoomHelp.tsx';
import type { Diary, DiaryEntry } from './persistence.ts';
import { advanceSeries, appendShot, applyConditions, attachProgressBaseline, bindTechnique, completePractice, currentSeries, deleteRound, deleteSeries,
  emptyPractice, findSeries, isRoundFull, removeShot, replaceShot, resumePractice,
  startRound, usedArrowNumbers } from './practice.ts';
import type { Practice } from './practice.ts';
import type { Shot } from './target.ts';
import { getTargetProfile } from './target.ts';
import type { TargetSpot } from './target.ts';
import { DEFAULT_TRIPLE_ORDER } from './preferences.ts';
import type { Conditions, RoundRule } from './conditions.ts';
import './style.css';
import './interaction-motion.css';

type Edit = { seriesId: number; index: number; shot: Shot };
const LocalRoomProbe = lazy(() => import('./LocalRoomProbe.tsx'));
const miss: Shot = { point: null, code: 'M', points: 0 };

function trainingSetup(practice: Practice): NonNullable<Diary['lastSetup']> {
  return { conditions: currentSeries(practice)!.series.conditions, rule: practice.roundRule, numberedArrows: practice.numberedArrows ?? null };
}

function initialDiary(): { diary: Diary | null; error: string } {
  try {
    return { diary: loadDiary(), error: '' };
  } catch (error) {
    return { diary: null, error: error instanceof Error ? error.message : 'Не удалось открыть дневник.' };
  }
}

function App() {
  useEffect(() => {
    if (!driveBackupAvailable) return;
    const retry = () => {
      if (document.visibilityState !== 'visible') return;
      void resumeDriveBackup();
      scheduleDriveBackup(0);
    };
    const unsubscribe = onJournalCommit(() => scheduleDriveBackup());
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    retry();
    return () => {
      unsubscribe();
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, []);
  const { preferences, readable: preferencesReadable, update: updatePreferences } = useTrainingPreferences();
  const googleAccount = useSyncExternalStore(subscribeDriveBackup, driveBackupState).account;
  const displayName = preferences.displayName || googleAccount?.name;
  const [state, setState] = useState(initialDiary);
  const diaryRef = useRef(state.diary);
  const diaryWrites = useRef(Promise.resolve());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<JournalTab>('home');
  const [progressView, setProgressView] = useState(defaultProgressView);
  const [page, setPage] = useState<'journal' | 'training' | 'editor' | 'report' | 'conditions' | 'settings' | 'statistics' | 'archive' | 'profile' | 'achievements' | 'records' | 'best-ranks' | 'notebook' | 'tournaments' | 'group-room'>('journal');
  const [tournamentsBack, setTournamentsBack] = useState<'journal' | 'profile'>('journal');
  const [tournamentPassportId, setTournamentPassportId] = useState<string | null>(null);
  const [tournamentSetup, setTournamentSetup] = useState<{ tournamentId: string; startId?: string }>();
  const [confirmTournament, setConfirmTournament] = useState<typeof tournamentSetup>();
  const [myTargetsOpen, setMyTargetsOpen] = useState(false);
  const [importReceipt, setImportReceipt] = useState(readImportReceipt);
  const [archiveBack, setArchiveBack] = useState<'journal' | 'settings'>('settings');
  useEffect(clearImportReceipt, []);
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [hostResults, setHostResults] = useState<{ history: RoomHistory; name?: string } | null>(null);
  const [hostClosePrompt, setHostClosePrompt] = useState<{ trainingId: string; roomId: string; remaining: number } | null>(null);
  const [hostClosing, setHostClosing] = useState(false);
  const [hostCloseError, setHostCloseError] = useState('');
  const [onboardingRequested, setOnboardingRequested] = useState(false);
  const [targetGuide, setTargetGuide] = useState<'standard' | 'triple' | null>(null);
  const [tutorialChapter, setTutorialChapter] = useState<Exclude<OnboardingChapter, 'welcome'> | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [achievementResetOpen, setAchievementResetOpen] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState<AchievementMoment[]>(() =>
    preferences.showAchievementNotices === false ? [] : recentAchievementNotices(state.diary?.achievementLedger));
  const [recordQueue, setRecordQueue] = useState<PersonalRecordEvent[]>(() => {
    if (preferences.showAchievementNotices === false || preferences.hideScores) return [];
    const now = Date.now();
    return state.diary?.entries.filter(entry => !entry.deletedAt && !entry.nativeArchiveSession).flatMap(entry =>
      entry.personalRecords?.filter(record => record.notifiedAtMs === null &&
        record.recordedAtMs <= now && now - record.recordedAtMs <= 10_000) ?? []) ?? [];
  });
  const [reportBack, setReportBack] = useState<'journal' | 'training' | 'profile' | 'records' | 'best-ranks' | 'notebook' | 'tournaments'>('journal');
  const [ranksBack, setRanksBack] = useState<'records' | 'profile'>('records');
  const [reportTrail, setReportTrail] = useState<string[]>([]);
  const [conditionsBack, setConditionsBack] = useState<'journal' | 'training' | 'report' | 'group-room'>('training');
  const [futureConditions, setFutureConditions] = useState(false);
  const [roomSetup, setRoomSetup] = useState<RoomMembership | null>(null);
  const [roomSwitch, setRoomSwitch] = useState<RoomMembership | null>(null);
  const [joiningOwnTraining, setJoiningOwnTraining] = useState(false);
  const [roomLeaderboardOpen, setRoomLeaderboardOpen] = useState(false);
  const [roomHelpOpen, setRoomHelpOpen] = useState(false);
  const syncingRoom = useRef(false);
  const syncRoomNow = useRef<(() => Promise<void>) | null>(null);
  const announcedRooms = useRef(new Map<string, string | null>());
  const [repeatSetup, setRepeatSetup] = useState<NonNullable<Diary['lastSetup']> | null>(null);
  const [setupMemo, setSetupMemo] = useState<TechniqueSelection | null>(null);
  const [historyFilters, setHistoryFilters] = useState(DEFAULT_HISTORY_FILTERS);
  const [notesScope, setNotesScope] = useState<DiaryNoteScope | null>(null);
  const [postHit, setPostHit] = useState<(Edit & { celebrated: boolean }) | null>(null);
  const [numberEditOpen, setNumberEditOpen] = useState(false);
  const [numberSaveError, setNumberSaveError] = useState(false);
  const [rankScope, setRankScope] = useState<{ kind: 'round' | 'series'; id: number } | null>(null);
  const [rankReference, setRankReference] = useState(false);
  const [rankProfileOrigin, setRankProfileOrigin] = useState<{
    page: 'report' | 'training' | 'editor' | 'best-ranks'; scope: typeof rankScope; reference: boolean;
  } | null>(null);
  const [selection, setSelection] = useState<number | null>(null);
  const editorReturnSelection = useRef<number | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [picker, setPicker] = useState<'round' | 'series' | null>(null);
  const [confirm, setConfirm] = useState<'finish' | 'delete' | 'discard'>('finish');
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const motionId = useRef(0);
  const [shotFeedback, setShotFeedback] = useState<(ShotMotionEvent & { sessionId: string; seriesId: number }) | null>(null);
  const cleanSeriesMilestones = useRef(new Map<string, number>());
  const firstTens = useRef(new Set<string>());
  const [finishMoment, setFinishMoment] = useState<{ sessionId: string; moment: TrainingMoment } | null>(null);
  const [finishHighlighting, setFinishHighlighting] = useState(false);
  const reportWasVisible = useRef(false);
  const [seriesTransition, setSeriesTransition] = useState<{ id: number; direction: 'previous' | 'next' }>();
  const [newRoundMotion, setNewRoundMotion] = useState<{ session: string | null; round: number }>();
  const [spotFocus, setSpotFocus] = useState<{ session: string | null; series: number; spot: TargetSpot | null }>();
  const [removedMarker, setRemovedMarker] = useState<{ id: number; seriesId: number; sessionId: string | null; shot: Shot; index: number }>();
  const pulse = useRef<Animation | null>(null);
  const [offline, setOffline] = useState<'pending' | 'ready' | 'error'>('pending');
  const [timerOpen, setTimerOpen] = useState(false);
  const [lensSettingsOpen, setLensSettingsOpen] = useState(false);
  const [techniqueOpen, setTechniqueOpen] = useState(false);
  const [memoSnapshot, setMemoSnapshot] = useState<TechniqueSelection | null>(null);

  useEffect(() => {
    const pending = new AbortController();
    enableOffline(pending.signal).then(() => {
      if (!pending.signal.aborted) setOffline('ready');
    }, () => {
      if (!pending.signal.aborted) setOffline('error');
    });
    return () => pending.abort();
  }, []);

  function writeDiary(change: (previous: Diary) => Diary, trainingId?: string, removingEvidence = false, correctingConditions = false): Promise<boolean> {
    const operation = diaryWrites.current.then(() => persistDiary(change, trainingId, removingEvidence, correctingConditions));
    diaryWrites.current = operation.then(() => {}, () => {});
    return operation;
  }

  async function persistDiary(change: (previous: Diary) => Diary, trainingId?: string, removingEvidence = false, correctingConditions = false): Promise<boolean> {
    const previous = diaryRef.current;
    if (!previous) return false;
    try {
      const proposed = change(previous);
      if (proposed === previous) return true;
      const now = new Date().toISOString();
      const awarded = trainingId && !removingEvidence ? awardTrainingChange(previous, proposed, trainingId, preferences.rankCategory ?? null, now)
        : { diary: proposed, added: [] };
      let next = trainingId ? correctingConditions
        ? reconcileConditionsCorrection(previous, proposed, trainingId, preferences.rankCategory ?? null, now)
        : removingEvidence ? removeAchievementEvidence(previous, proposed, trainingId, now)
        : awardRoomAchievements(awarded.diary, trainingId, now) : awarded.diary;
      let newRecords: PersonalRecordEvent[] = [];
      let moment: TrainingMoment | undefined;
      if (trainingId && !removingEvidence) {
        const before = previous.entries.find(entry => entry.id === trainingId);
        const current = next.entries.find(entry => entry.id === trainingId);
        if (before && current && !before.practice.savedAt && current.practice.savedAt && current.personalRecords === undefined) {
          newRecords = calculatePersonalRecordEvents(current, previous.entries, preferences.rankCategory ?? null, Date.parse(current.practice.savedAt));
          if (!preferences.hideScores) moment = trainingMoment(current, previous.entries, preferences.rankCategory ?? null, newRecords,
            preferences.showAchievementNotices === false ? [] : next.achievementLedger?.grants);
          if (preferences.showAchievementNotices === false || preferences.hideScores) {
            newRecords = newRecords.map(record => ({ ...record, notifiedAtMs: record.recordedAtMs }));
          }
          next = { ...next, entries: next.entries.map(entry => entry.id === trainingId ? { ...entry, personalRecords: newRecords } : entry) };
        }
      }
      const known = new Set(previous.achievementLedger?.grants.map(grant => `${grant.id}:${grant.scope}`));
      const added = next.achievementLedger?.grants.filter(grant => !known.has(`${grant.id}:${grant.scope}`)) ?? [];
      const noticeMoment = added.length && !correctingConditions ? crypto.randomUUID() : undefined;
      if (noticeMoment && next.achievementLedger) next = { ...next,
        achievementLedger: { ...next.achievementLedger, grants: next.achievementLedger.grants.map(grant =>
          known.has(`${grant.id}:${grant.scope}`) ? grant : { ...grant, noticeMoment,
            ...(preferences.showAchievementNotices === false ? { notifiedAt: new Date().toISOString() } : {}) }) } };
      await saveDiary(next, previous);
      diaryRef.current = next;
      setState({ diary: next, error: '' });
      if (removingEvidence) {
        const retained = new Set((next.achievementLedger?.grants ?? [])
          .filter(grant => grant.sessionId !== trainingId || !dependsOnTraining(grant.id) ||
            !next.entries.some(item => item.id === trainingId && item.deletedAt))
          .map(achievementReceiptKey));
        setAchievementQueue(queue => queue.flatMap(pending => {
          const remaining = pending.grants.filter(grant => retained.has(achievementReceiptKey(grant)));
          return remaining.length ? [{ ...pending, grants: remaining }] : [];
        }));
      }
      if (correctingConditions) {
        const records = new Set(next.entries.flatMap(entry => entry.personalRecords?.map(record => record.id) ?? []));
        setRecordQueue(queue => queue.filter(record => records.has(record.id)));
        setFinishMoment(current => current?.sessionId === trainingId ? null : current);
      }
      if (moment && trainingId) {
        setFinishMoment({ sessionId: trainingId, moment });
        setFinishHighlighting(preferences.animations && preferences.celebrationEffects !== false
          && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      }
      if (noticeMoment && preferences.showAchievementNotices !== false) {
        setAchievementQueue(queue => [...queue, { id: noticeMoment, grants: next.achievementLedger!.grants.filter(grant => grant.noticeMoment === noticeMoment) }]);
      }
      if (newRecords.length && preferences.showAchievementNotices !== false && !preferences.hideScores) {
        setRecordQueue(queue => [...queue, ...newRecords]);
      }
      return true;
    } catch (cause) {
      setState({ diary: previous, error: cause instanceof Error && !('code' in cause)
        ? cause.message : 'Не удалось сохранить изменение. Повтори действие.' });
      return false;
    }
  }

  function recordServiceAchievement(id: AchievementActionId, trainingId?: string) {
    writeDiary(previous => awardServiceAction(previous, id, new Date().toISOString(), trainingId));
  }

  async function refreshRoomHistory(trainingId: string, membership: RoomMembership, manual = false) {
    const snapshot = await roomSnapshot(membership.invitation);
    const history = readRoomHistory(snapshot);
    if (!await saveRoomHistory(trainingId, history, readRoomName(snapshot) ?? membership.roomName, manual)) {
      throw new Error('Не удалось сохранить таблицу.');
    }
    return history;
  }

  function saveRoomHistory(trainingId: string, history: RoomHistory, roomName?: string, manual = false) {
    return writeDiary(previous => {
      const item = previous.entries.find(candidate => candidate.id === trainingId && !candidate.deletedAt);
      if (!item || item.groupRoomHistory?.finalizedAt ||
        !history.finalizedAt && (item.groupRoomHistory?.receivedAt ?? 0) > history.receivedAt) return previous;
      if (!manual && (!roomName || roomName === item.groupRoomName) &&
        JSON.stringify(item.groupRoomHistory?.series) === JSON.stringify(history.series) &&
        JSON.stringify(item.groupRoomHistory?.participants) === JSON.stringify(history.participants) &&
        item.groupRoomHistory?.trainingCompletion === history.trainingCompletion &&
        item.groupRoomHistory?.finalizedAt === history.finalizedAt) return previous;
      const updated = { ...previous, entries: previous.entries.map(candidate => candidate === item ? { ...item,
        groupRoomName: roomName ?? item.groupRoomName ?? 'Групповая тренировка', groupRoomHistory: history,
      } : candidate) };
      return awardRoomAchievements(updated, trainingId, new Date(history.receivedAt).toISOString());
    });
  }

  async function finalizeHostedRoom(expectedId?: string) {
    const snapshot = await roomBridge.finalizeResults(expectedId ? { roomId: expectedId } : undefined);
    const history = readRoomHistory(snapshot);
    if (!history.finalizedAt) throw new Error('Комната не подтвердила итоги.');
    const name = readRoomName(snapshot);
    const diary = diaryRef.current;
    const participants = new Set([...history.participants, ...history.series].map(person => person.entryId));
    for (const journal of diary?.groupSeries ?? []) {
      if (journal.trainingId && (journal.roomId === expectedId || participants.has(journal.entryId)) &&
        !await saveRoomHistory(journal.trainingId, history, name, true)) {
        throw new Error('Комната закрыта. Не удалось сохранить итоги в дневник. Откройте их повторно.');
      }
    }
    return { history, name };
  }

  useEffect(() => {
    if (!supportsLocalRoom()) return;
    const retry = async () => {
      if (syncingRoom.current || document.visibilityState !== 'visible') return;
      const diary = diaryRef.current;
      const entriesById = new Map(diary?.entries.map(item => [item.id, item]));
      const journals = diary?.groupSeries?.filter(journal => {
        const item = entriesById.get(journal.trainingId ?? '');
        if (!item || item.deletedAt || item.groupRoomHistory?.finalizedAt) return false;
        return (!item.practice.savedAt && !item.paused) || pendingGroupSeries(journal).length ||
          (!!item.practice.savedAt && Date.now() - Date.parse(item.practice.savedAt) <
            (item.groupRoomHistory?.trainingCompletion ? 86_400_000 : 60_000));
      }) ?? [];
      if (!journals.length) return;
      syncingRoom.current = true;
      try {
        for (const journal of journals) {
          let membership: RoomMembership | null;
          try { membership = loadRoomMembership(journal.entryId); }
          catch { continue; }
          if (!membership || !journal.trainingId) continue;
          const entry = entriesById.get(journal.trainingId)!;
          if (!entry.practice.savedAt && !entry.paused) {
            const category = currentSeries(entry.practice)?.series.conditions.equipment?.bow.category ?? null;
            if (membership.roomName && (!announcedRooms.current.has(journal.entryId) || announcedRooms.current.get(journal.entryId) !== category)) {
              try {
                await announceRoomEntry(membership, category);
                announcedRooms.current.set(journal.entryId, category);
              } catch { /* Older hosts can still accept classic series. */ }
            }
          }
          try { await sendPendingGroupSeries(journal.entryId, roomTransport(journal.entryId), () => diaryRef.current, writeDiary); }
          catch { /* No receipt was stored. The next attempt will retry the latest revision. */ }
          try {
            const history = await refreshRoomHistory(journal.trainingId, membership);
            if (history.finalizedAt || !history.trainingCompletion) continue;
            const current = diaryRef.current;
            const finished = current?.entries.find(item => item.id === journal.trainingId && item.practice.savedAt && !item.deletedAt);
            const latest = current?.groupSeries?.find(item => item.entryId === journal.entryId);
            if (!finished || !latest || pendingGroupSeries(latest).length) continue;
            const person = history.participants.find(item => item.entryId === journal.entryId);
            if (person?.finished) continue;
            if (!person) {
              const bow = currentSeries(finished.practice)?.series.conditions.equipment?.bow.category ?? null;
              await announceRoomEntry(membership, bow);
            }
            if (diaryRef.current !== current) continue;
            await finishRoomTraining(membership, latest.ends.reduce((sum, end) => sum + end.revision, 0));
            announcedRooms.current.delete(journal.entryId);
            await refreshRoomHistory(journal.trainingId, membership);
          } catch {
            // Keep the last snapshot and retry unconfirmed completion on the next exchange.
          }
        }
      } finally { syncingRoom.current = false; }
    };
    syncRoomNow.current = retry;
    const timer = window.setInterval(() => void retry(), 4000);
    window.addEventListener('online', retry);
    return () => { syncRoomNow.current = null; window.clearInterval(timer); window.removeEventListener('online', retry); };
  }, []);

  async function recordPublication({ documentId, content }: { documentId: string; content: string }) {
    const epoch = diaryRef.current?.achievementLedger?.epoch;
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
      const fingerprint = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
      writeDiary(previous => previous.achievementLedger?.epoch === epoch
        ? awardPublication(previous, documentId, fingerprint, new Date().toISOString()) : previous);
    } catch (cause) { setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'Не удалось сохранить достижение памятки.' })); }
  }

  function update(change: (previous: Practice) => Practice, rememberSetup = false, removingEvidence = false, correctingConditions = false): Promise<boolean> {
    return writeDiary(previous => {
      const entry = previous.entries.find(item => item.id === sessionId);
      if (!entry) return previous;
      let practice = change(entry.practice);
      if (practice === entry.practice) return rememberSetup ? { ...previous, lastSetup: trainingSetup(practice) } : previous;
      if (correctingConditions && !entry.source && !entry.nativeArchiveSession && !previous.groupSeries?.some(journal => journal.trainingId === entry.id)) {
        practice = refreshCorrectedProgress(entry.practice, practice, previous.entries, entry);
      }
      // Deleting the final shot from a finished session leaves no saved session.
      const remove = entry.practice.savedAt !== null && practice.savedAt === null &&
        !practice.rounds.some(round => round.series.some(series => series.shots.length));
      if (remove && entry.notes?.length) practice = { ...practice, savedAt: entry.practice.savedAt };
      const noteSeries = practice.rounds.flatMap(round => round.series);
      const notes = entry.notes?.map(note => {
        if (note.seriesId === undefined || noteSeries.some(series => series.id === note.seriesId && series.shots.length)) return note;
        const { seriesId: _series, ...sessionNote } = note;
        return sessionNote;
      });
      const trainingTime = entry.practice.savedAt !== null && practice.savedAt === null
        ? startTrainingTime(Date.now(), entry.trainingTime, true)
        : practice.savedAt !== null && entry.practice.savedAt === null && entry.trainingTime
          ? stopTrainingTime(entry.trainingTime, Date.parse(practice.savedAt)) : entry.trainingTime;
      return { ...updateGroupSeriesInDiary(previous, entry.id, practice), ...(rememberSetup && { lastSetup: trainingSetup(practice) }), entries: previous.entries.flatMap(item => item.id !== entry.id ? [item]
        : remove && !notes?.length ? [] : [{ ...item, practice,
          ...(entry.practice.savedAt !== null && practice.savedAt === null && item.personalRecords === undefined ? { personalRecords: [] } : {}),
          ...(notes ? { notes } : {}), ...(trainingTime ? { trainingTime } : {}) }]) };
    }, sessionId ?? undefined, removingEvidence, correctingConditions);
  }

  async function saveEdit(keepSelection = false): Promise<boolean> {
    if (!edit) return true;
    if (!await update(previous => replaceShot(previous, edit.seriesId, edit.index, edit.shot))) return false;
    if (!keepSelection) setEdit(null);
    return true;
  }

  async function showSeries(seriesId: number) {
    if (!await saveEdit()) return;
    const nextIndex = seriesIds.indexOf(seriesId);
    if (nextIndex !== -1 && nextIndex !== position) setSeriesTransition({ id: seriesId, direction: nextIndex < position ? 'previous' : 'next' });
    setSelection(seriesId);
    setPage('training');
    setPicker(null);
  }

  function openSeriesEditor(seriesId: number) {
    editorReturnSelection.current = selection;
    setEdit(null);
    setSelection(seriesId);
    setPage('editor');
  }

  function closeSeriesEditor() {
    setSelection(editorReturnSelection.current);
    setPage('report');
  }

  const entries = state.diary?.entries ?? [];
  const tournaments = state.diary?.tournaments ?? [];
  const entry = entries.find(item => item.id === sessionId);
  const roomJournal = state.diary?.groupSeries?.find(item => item.trainingId === sessionId);
  const lastClosedRoomSeries = roomJournal?.ends.reduce((last, end) => end.result ? end.ordinal : last, 0) ?? 0;
  const pendingRoomCount = roomJournal ? pendingGroupSeries(roomJournal).length : 0;
  const ongoing = entries.find(item => item.practice.savedAt === null && !item.paused && !item.deletedAt);
  const roomPreviewSeries = roomSwitch && ongoing ? ongoing.practice.rounds.flatMap(round => round.series)
    .slice(0, -1).filter(series => series.shots.length) : [];
  const paused = entries.filter(item => item.paused && !item.deletedAt).sort(compareDiaryDate)[0];
  const recent = useMemo(() => entries.filter(item => item.practice.savedAt !== null && !item.deletedAt)
    .sort(compareDiaryDate), [entries]);
  const reportPosition = useRef<{ id: string; position?: ReportPosition } | null>(null);
  const reportIndex = recent.findIndex(item => item.id === sessionId);
  const initial = useMemo(emptyPractice, []);
  const practice = entry?.practice ?? initial;
  const setup = page === 'conditions' && (!entry || repeatSetup !== null);
  const suggested = state.diary?.lastSetup ?? trainingSetup((ongoing ?? paused ?? recent[0])?.practice ?? initial);
  const setupDefaults = repeatSetup ?? suggested;
  let newConditions = setupDefaults.conditions;
  let needsHomeEquipment = false;
  if ((!ongoing || tournamentSetup) && newConditions.equipment && ((page === 'journal' && tab === 'home') || setup)) {
    try {
      const currentKit = equipmentSnapshot(loadEquipment(), newConditions.equipment.id);
      newConditions = { ...newConditions, equipment: currentKit };
      needsHomeEquipment = !currentKit;
    } catch {
      // Conditions can still open so the equipment picker can show its read error.
      newConditions = { ...newConditions, equipment: null };
      needsHomeEquipment = true;
    }
  }
  const continuing = ongoing ?? paused;
  const homeConditions = continuing ? trainingSetup(continuing.practice).conditions : newConditions;

  function refreshConditions(conditions: Conditions): Conditions | null {
    if (!conditions.equipment) return conditions;
    try {
      const kit = equipmentSnapshot(loadEquipment(), conditions.equipment.id);
      if (kit) return { ...conditions, equipment: kit };
      setState(previous => ({ ...previous, error: 'Этот комплект недоступен. Выбери другой в условиях.' }));
      return null;
    } catch (cause) {
      setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'Не удалось прочитать комплект.' }));
      return null;
    }
  }

  function selectEntry(item: DiaryEntry, next: 'training' | 'report' | 'conditions') {
    setFinishMoment(null);
    setFinishHighlighting(false);
    setSeriesTransition(undefined);
    setRemovedMarker(undefined);
    setSessionId(item.id);
    setSelection(null);
    setEdit(null);
    setPage(next);
  }

  async function startPractice(conditions?: Conditions, rule = suggested.rule, numberedArrows = suggested.numberedArrows, tournament?: TournamentChoice, title?: string) {
    if (ongoing && !roomSetup && !tournamentSetup) { selectEntry(ongoing, 'training'); return true; }
    if (!conditions && paused) return resumeEntry(paused);
    const chosen = refreshConditions(conditions ?? suggested.conditions);
    if (!chosen) return false;
    let next = applyConditions(emptyPractice(), chosen, rule, numberedArrows);
    if (setupMemo) next = bindTechnique(next, setupMemo);
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const baseline = freezeProgressBaseline(diaryRef.current?.entries ?? [], id, startedAt, chosen, startedAt);
    const achievementLedger = diaryRef.current?.achievementLedger ?? { epoch: crypto.randomUUID(), grants: [] };
    const item: DiaryEntry = { id, startedAt, createdAt: startedAt, practice: attachProgressBaseline(next, baseline), trainingTime: startTrainingTime(Date.parse(startedAt)),
      ...(title ? { title } : {}),
      ...(roomSetup ? { groupRoomName: roomSetup.roomName ?? 'Групповая тренировка' } : {}),
      achievementEnrollment: { epoch: achievementLedger.epoch, rankCategory: preferences.rankCategory ?? null,
        stageRankVersion: STAGE_RANK_ENROLLMENT_VERSION, seriesStories: true, ...(roomSetup ? { roomAwards: true as const } : {}) } };
    if (roomSetup) {
      try { saveRoomMembership(roomSetup); }
      catch { setState(previous => ({ ...previous, error: 'Не удалось сохранить приглашение в комнату.' })); return false; }
    }
    if (!await writeDiary(previous => {
      // Pause the previous practice in the same write that creates the new one.
      const existing = (roomSetup || tournamentSetup) && ongoing ? previous.entries.map(candidate => candidate.id === ongoing.id ? {
        ...candidate, paused: true,
        ...(candidate.trainingTime ? { trainingTime: stopTrainingTime(candidate.trainingTime, Date.parse(startedAt)) } : {}),
      } : candidate) : previous.entries;
      const draft = { ...previous, achievementLedger, lastSetup: trainingSetup(next), entries: [...existing, item] };
      if (roomSetup) draft.groupSeries = [...(previous.groupSeries ?? []), { ...newGroupSeriesJournal(roomSetup.roomId, roomSetup.entryId, item.practice), trainingId: id }];
      return tournament ? linkTournamentSession(draft, tournament, id) : draft;
    })) return false;
    setSetupMemo(null);
    setTournamentSetup(undefined);
    setRepeatSetup(null);
    setRoomSetup(null);
    selectEntry(item, 'training');
    if (item.groupRoomName) void syncRoomNow.current?.();
    return true;
  }

  function openSaved(id: string) {
    const item = entries.find(candidate => candidate.id === id);
    if (!item) return;
    setReportTrail([]);
    setReportBack('journal');
    selectEntry(item, item.practice.savedAt || item.paused || item.deletedAt ? 'report' : 'training');
  }

  function prepareRoomTraining(membership: RoomMembership) {
    setRoomSwitch(null);
    setRoomSetup(membership); setSetupMemo(null); setRepeatSetup(null); setSessionId(null);
    setConditionsBack('group-room'); setPage('conditions');
  }

  async function joinWithOwnTraining(membership: RoomMembership, id: string) {
    setJoiningOwnTraining(true);
    try {
      saveRoomMembership(membership);
      const joined = await writeDiary(previous => {
        const own = previous.entries.find(item => item.id === id && item.practice.savedAt === null && !item.paused && !item.deletedAt);
        if (!own) throw new Error('Активная тренировка уже изменилась. Открой комнату заново.');
        const linked = previous.groupSeries?.find(journal => journal.trainingId === id);
        if (linked?.entryId === membership.entryId) return previous;
        if (linked || own.groupRoomName || own.groupRoomHistory) throw new Error('Эта тренировка уже привязана к другой комнате.');
        if (previous.groupSeries?.some(journal => journal.roomId === membership.roomId)) throw new Error('Ты уже входил в эту комнату.');
        const groupRoomName = membership.roomName ?? 'Групповая тренировка';
        return { ...previous, entries: previous.entries.map(item => item.id === id ? { ...item, groupRoomName,
          ...(item.achievementEnrollment ? { achievementEnrollment: { ...item.achievementEnrollment, roomAwards: true as const } } : {}) } : item),
          groupSeries: [...(previous.groupSeries ?? []), { ...newGroupSeriesJournal(membership.roomId, membership.entryId, own.practice), trainingId: id }] };
      });
      const attached = joined && diaryRef.current?.entries.find(item => item.id === id);
      if (attached) {
        setRoomSwitch(null);
        selectEntry(attached, 'training');
        void syncRoomNow.current?.();
      }
    } catch {
      setState(previous => ({ ...previous, error: 'Не удалось сохранить приглашение в комнату.' }));
    } finally { setJoiningOwnTraining(false); }
  }

  function enterRoomTraining(membership: RoomMembership) {
    for (const journal of state.diary?.groupSeries ?? []) {
      if (journal.roomId !== membership.roomId) continue;
      const previous = loadRoomMembership(journal.entryId);
      if (!previous || previous.roomId !== membership.roomId) continue;
      saveRoomMembership({ ...previous, invitation: membership.invitation, roomName: membership.roomName ?? previous.roomName,
        cg3: membership.cg3 ?? previous.cg3, pg1: membership.pg1 ?? previous.pg1 });
      const item = entries.find(candidate => candidate.id === journal.trainingId && !candidate.deletedAt);
      if (item) {
        if (item === ongoing) selectEntry(item, 'training');
        else openSaved(item.id);
        return;
      }
    }
    if (ongoing) setRoomSwitch(membership);
    else prepareRoomTraining(membership);
  }

  async function resumeEntry(item: DiaryEntry) {
    if (ongoing && ongoing.id !== item.id) {
      setState(previous => ({ ...previous, error: 'Сначала заверши активную тренировку.' }));
      return false;
    }
    if (!await writeDiary(previous => ({ ...previous, entries: previous.entries.map(entry => entry.id === item.id ? {
      ...entry, paused: false, practice: resumePractice(entry.practice),
      personalRecords: entry.personalRecords ?? (entry.practice.savedAt !== null || entry.nativeArchiveSession ? [] : undefined),
      trainingTime: startTrainingTime(Date.now(), entry.trainingTime, true),
    } : entry) }))) return false;
    setSelection(null);
    setReportTrail([]);
    selectEntry(diaryRef.current!.entries.find(entry => entry.id === item.id)!, 'training');
    void syncRoomNow.current?.();
    return true;
  }

  async function pauseEntry() {
    if (!entry || entry.paused || completed || !await saveEdit()) return;
    if (await writeDiary(previous => ({ ...previous, entries: previous.entries.map(item => item.id === entry.id ? {
      ...item, paused: true,
      ...(item.trainingTime ? { trainingTime: stopTrainingTime(item.trainingTime, Date.now()) } : {}),
    } : item) }))) setPage('journal');
  }

  function openRecordReport(id: string, from: 'profile' | 'records' | 'best-ranks' | 'notebook' | 'report', roundId?: number) {
    const item = recent.find(candidate => candidate.id === id);
    if (!item) return;
    if (from === 'report' && sessionId) setReportTrail(trail => [...trail, sessionId]);
    else if (from !== 'report') { setReportTrail([]); setReportBack(from); }
    selectEntry(item, 'report');
    if (roundId !== undefined) reportPosition.current = { id, position: { blocks: ['series'], anchor: 'series', offset: 0, roundId } };
  }

  function leaveReport() {
    const previousId = reportTrail.at(-1);
    const previous = previousId && entries.find(item => item.id === previousId);
    setReportTrail(trail => trail.slice(0, -1));
    if (previous) selectEntry(previous, 'report');
    else setPage(reportBack);
  }

  const active = currentSeries(practice)!;
  const visible = (selection === null ? null : findSeries(practice, selection)) ?? active;
  const series = visible.series;
  const round = visible.round;
  const past = series.id !== active.series.id;
  const completed = practice.savedAt !== null;
  const timer = usePracticeTimer(!!ongoing, preferences.haptics);
  useEffect(() => { if (!ongoing) setTimerOpen(false); }, [ongoing]);
  const screenError = useKeepScreenOn(!completed && !!entry && page === 'training');
  const editing = edit?.seriesId === series.id ? edit : null;
  const seriesEditor = page === 'editor';
  const dirty = editing !== null && JSON.stringify(editing.shot) !== JSON.stringify(series.shots[editing.index]);
  const arrowCount = series.conditions.equipment?.arrows.numberedCount ?? 0;
  const numbering = arrowCount > 0 && (practice.numberedArrows ?? true);
  const pendingShot = page === 'training' && postHit?.seriesId === series.id && series.shots[postHit.index] === postHit.shot ? postHit : null;
  useEffect(() => {
    if (postHit && !pendingShot) setPostHit(null);
  }, [postHit, pendingShot]);
  const shots = editing ? series.shots.map((shot, index) => index === editing.index ? editing.shot : shot) : series.shots;
  const roundShown = round.series.flatMap(item => item.id === series.id ? shots : item.shots);
  const rankCategory = preferences.rankCategory ?? null;
  const projectedPractice = useMemo(() => editing ? replaceShot(practice, editing.seriesId, editing.index, editing.shot)
    : practice, [practice, editing]);
  const showNorms = statisticVisible(preferences, 'norms');
  const currentRanks = useMemo(() => page === 'training' && !preferences.hideScores && showNorms ? {
    round: roundRank(projectedPractice, round.id, rankCategory),
    series: seriesRank(projectedPractice, series.id, rankCategory),
  } : null, [page, preferences.hideScores, showNorms, projectedPractice, round.id, series.id, rankCategory]);
  const shownRank = rankScope ? (rankScope.kind === 'round' ? roundRank : seriesRank)(projectedPractice, rankScope.id, rankCategory) : null;
  const targetSpec = useMemo(() => ({ profileId: series.conditions.targetProfileId, diameterMm: series.conditions.targetDiameterMm,
    shaftDiameterMm: series.conditions.equipment?.arrows.diameterMm ?? 6 }), [series.conditions]);
  const isTripleTarget = getTargetProfile(targetSpec.profileId)?.vertical === true;
  const guideKind = isTripleTarget ? 'triple' : 'standard';
  const tripleOrder = preferences.tripleOrder ?? DEFAULT_TRIPLE_ORDER;
  const autoSpot = isTripleTarget && preferences.tripleAutoAdvance && !past && !completed && !seriesEditor;
  const nextSpot = (spot: TargetSpot) => tripleOrder[(tripleOrder.indexOf(spot) + 1) % tripleOrder.length];
  const focusedSpot = spotFocus?.session === sessionId && spotFocus.series === series.id ? spotFocus.spot
    : autoSpot ? series.shots.reduce<TargetSpot>((spot, shot) => nextSpot(shot.spot ?? spot), tripleOrder[0]) : null;

  function focusSpot(spot: TargetSpot | null) { setSpotFocus({ session: sessionId, series: series.id, spot }); }

  function advanceSpot(shot: Shot) {
    if (autoSpot) focusSpot(nextSpot(shot.spot ?? focusedSpot ?? tripleOrder[0]));
  }

  function acknowledgeTargetGuide() {
    if (preferencesReadable && !preferences.seenTargetGuide?.[guideKind]) {
      void updatePreferences({ ...preferences, seenTargetGuide: { ...preferences.seenTargetGuide, [guideKind]: true } });
    }
  }

  useEffect(() => {
    if (page !== 'training' || newRoundMotion?.round !== round.id) setNewRoundMotion(undefined);
    if (page !== 'training' || !preferences.tripleAutoAdvance) setSpotFocus(undefined);
  }, [page, round.id, newRoundMotion?.round, preferences.tripleAutoAdvance, preferences.tripleOrder]);
  const roundFull = isRoundFull(practice);
  const canAppend = !seriesEditor && !!entry && !past && !completed && !(practice.roundRule.unit === 'arrows' && roundFull);
  const canInput = !pendingShot && (editing !== null || canAppend);
  const allSeries = practice.rounds.flatMap(item => item.series);
  const seriesIds = allSeries.map(end => end.id);
  const position = seriesIds.indexOf(series.id);
  const previousVolume = !seriesEditor && !past && !completed ? allSeries[position - 1]?.shots.length ?? 0 : 0;
  const hasHits = practice.rounds.some(item => item.series.some(end => end.shots.length));
  const nextIsRound = !editing && !seriesEditor && !completed && !past && roundFull;
  const mainText = editing || seriesEditor ? 'Сохранить' : completed ? 'К статистике'
    : nextIsRound ? 'Следующий раунд' : 'Следующая серия';
  const suggestRound = !seriesEditor && roundFull && !canAppend && !past && !editing && !completed;
  useEffect(() => {
    if (!suggestRound) {
      pulse.current?.cancel();
      pulse.current = null;
    }
  }, [suggestRound]);
  const showTrainingMotion = page === 'training' && preferences.animations && !preferences.hideScores && !editing;
  useEffect(() => {
    if (reportWasVisible.current && page !== 'report') setFinishMoment(null);
    reportWasVisible.current = page === 'report';
  }, [page]);
  useEffect(() => {
    if (page !== 'report' || !finishHighlighting) return;
    const timeout = setTimeout(() => setFinishHighlighting(false), 1050);
    return () => clearTimeout(timeout);
  }, [page, finishHighlighting]);
  const activeRemovedMarker = removedMarker?.sessionId === sessionId && removedMarker.seriesId === series.id ? removedMarker : undefined;
  const activeShotFeedback = showTrainingMotion && shotFeedback?.sessionId === sessionId && shotFeedback?.seriesId === series.id
    ? shotFeedback : undefined;
  useEffect(() => {
    if (shotFeedback && (!showTrainingMotion || shotFeedback.sessionId !== sessionId || shotFeedback.seriesId !== series.id)) setShotFeedback(null);
  }, [showTrainingMotion, shotFeedback, sessionId, series.id]);
  useEffect(() => {
    if (!shotFeedback) return;
    const timeout = setTimeout(() => setShotFeedback(null), SHOT_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [shotFeedback]);
  useEffect(() => {
    if (!removedMarker) return;
    const timeout = setTimeout(() => setRemovedMarker(undefined), 190);
    return () => clearTimeout(timeout);
  }, [removedMarker]);
  function canPlayTrainingMotion() {
    return showTrainingMotion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function playShotMotion(index: number, shot: Shot, cleanSeries?: CleanSeriesMotion) {
    if (sessionId && canPlayTrainingMotion()) {
      const bow = series.conditions.equipment?.bow.category ?? null;
      const key = `${sessionId}:${bow ?? 'unknown'}`;
      const firstTen = shot.points === 10 && preferences.celebrationEffects !== false && !firstTens.current.has(key)
        && !practice.rounds.some(item => item.series.some(end => (end.conditions.equipment?.bow.category ?? null) === bow
          && (end.id === series.id ? end.shots.slice(0, index) : end.shots).some(previous => previous.points === 10)))
        && !hasFinishedCleanSeries(diaryRef.current?.entries ?? [], bow, sessionId);
      if (shot.points === 10) firstTens.current.add(key);
      setShotFeedback({ id: ++motionId.current, sessionId, seriesId: series.id, index, points: shot.points, cleanSeries, firstTen });
    }
  }

  function cleanSeriesMotion(index: number, savedShots: readonly Shot[]): CleanSeriesMotion | undefined {
    const arrows = index + 1;
    if (!sessionId || preferences.celebrationEffects === false || !canPlayTrainingMotion() || arrows !== shotStripCapacity(arrows, previousVolume)
      || !savedShots.slice(0, arrows).every(shot => shot.points === 10)) return;
    const key = `${sessionId}:${series.id}`;
    if (arrows <= (cleanSeriesMilestones.current.get(key) ?? 0)) return;
    cleanSeriesMilestones.current.set(key, arrows);
    return arrows === shotStripCapacity(0, previousVolume) ? 'jump' : 'glint';
  }

  async function mark(shot: Shot) {
    if (pendingShot) return;
    if (editing) {
      const updated = { ...editing.shot, ...shot };
      if (!shot.missPoint) delete updated.missPoint;
      if (!shot.point && !shot.missPoint) delete updated.spot;
      setEdit({ ...editing, shot: updated });
    }
    else if (canAppend) {
      // The shot is stored before the number picker opens. Keep its current camera until the picker closes.
      if (autoSpot && numbering) focusSpot(focusedSpot);
      let index = -1;
      const saved = await update(previous => {
        const latest = currentSeries(previous)?.series;
        if (latest?.id !== series.id || numbering && latest.shots.length !== shots.length) return previous;
        index = latest.shots.length;
        return appendShot(previous, shot);
      });
      const stored = diaryRef.current?.entries.find(item => item.id === sessionId)?.practice;
      const savedShots = stored && findSeries(stored, series.id)?.series.shots;
      if (index < 0 || !saved || !savedShots || savedShots[index] !== shot) return;
      acknowledgeTargetGuide();
      const cleanSeries = cleanSeriesMotion(index, savedShots);
      if (preferences.haptics) performTrainingHaptic();
      if (numbering) {
        setNumberSaveError(false);
        setPostHit({ seriesId: series.id, index, shot, celebrated: cleanSeries !== undefined });
        if (cleanSeries) playShotMotion(index, shot, cleanSeries);
      } else {
        playShotMotion(index, shot, cleanSeries);
        advanceSpot(shot);
      }
    }
  }

  function closeNumberPicker() {
    if (pendingShot) {
      if (!pendingShot.celebrated) playShotMotion(pendingShot.index, pendingShot.shot);
      advanceSpot(pendingShot.shot);
    }
    setPostHit(null);
    setNumberEditOpen(false);
    setNumberSaveError(false);
  }

  async function chooseArrowNumber(value: number | undefined) {
    if (numberEditOpen && editing) {
      setEdit({ ...editing, shot: { ...editing.shot, physicalArrowNumber: value } });
      closeNumberPicker();
    } else if (pendingShot && value !== undefined) {
      if (await update(previous => replaceShot(previous, pendingShot.seriesId, pendingShot.index,
        { ...pendingShot.shot, physicalArrowNumber: value }))) closeNumberPicker();
      else setNumberSaveError(true);
    }
  }

  async function mainAction() {
    if (editing) await saveEdit(seriesEditor);
    else if (completed) setPage('report');
    else if (past) showSeries(seriesIds[position + 1]);
    else if (await update(advanceSeries)) {
      const next = diaryRef.current?.entries.find(item => item.id === sessionId);
      const id = next && currentSeries(next.practice)?.series.id;
      if (id !== undefined && id !== series.id) setSeriesTransition({ id, direction: 'next' });
      afterRoundCreated();
      setSelection(null);
    }
  }

  function afterRoundCreated() {
    const next = diaryRef.current?.entries.find(item => item.id === sessionId);
    const newRound = next && currentSeries(next.practice)?.round.id;
    if (newRound !== undefined && newRound !== active.round.id && preferences.animations && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setNewRoundMotion({ session: sessionId, round: newRound });
    }
  }

  async function chooseShot(index: number) {
    const shot = shots[index];
    if (pendingShot || !shot) return;
    if (editing?.index === index) {
      if (seriesEditor && !dirty) setEdit(null);
      return;
    }
    if (!await saveEdit()) return;
    setEdit({ seriesId: series.id, index, shot });
  }

  async function removeMarkedShot(index: number) {
    const shot = series.shots[index];
    if (!shot || !await update(previous => removeShot(previous, series.id, index), false, true)) return false;
    if (preferences.animations && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRemovedMarker({ id: ++motionId.current, seriesId: series.id, sessionId, shot, index });
    }
    return true;
  }

  function undo() {
    if (editing) setEdit(seriesEditor ? { ...editing, shot: series.shots[editing.index] } : null);
    else if (!past && !completed && shots.length) void removeMarkedShot(shots.length - 1);
  }

  async function openPicker(kind: 'round' | 'series') {
    if (await saveEdit()) setPicker(kind);
  }

  function openConfirm(kind: 'finish' | 'delete' | 'discard') {
    setConfirm(kind);
    confirmDialog.current?.showModal();
  }

  async function leaveTraining() {
    // A pointer down on the close button delivers any tap still waiting on the target.
    await diaryWrites.current;
    const current = diaryRef.current?.entries.find(item => item.id === sessionId)?.practice;
    if (current?.savedAt) setPage('report');
    else if (current?.rounds.some(item => item.series.some(end => end.shots.length))) openConfirm('finish');
    else if (await writeDiary(previous => ({ ...previous, entries: previous.entries.filter(item => item.id !== sessionId),
      ...(previous.tournaments && sessionId ? { tournaments: unlinkTournamentSession(previous.tournaments, sessionId) } : {}),
    }))) {
      setSessionId(null);
      setTab('home');
      setPage('journal');
    }
  }

  async function confirmAction() {
    if (confirm === 'discard') {
      setEdit(null);
    } else if (confirm === 'delete' && editing) {
      if (await removeMarkedShot(editing.index)) {
        setEdit(null);
        if (!diaryRef.current?.entries.some(item => item.id === sessionId)) setPage('journal');
        else if (seriesEditor && series.shots.length === 1) closeSeriesEditor();
      }
    } else if (confirm === 'finish' && await update(previous => completePractice(previous, new Date().toISOString()))) {
      setSelection(null);
      setReportTrail([]);
      setReportBack('journal');
      setPage('report');
      if (roomJournal && sessionId) void (async () => {
        await syncRoomNow.current?.();
        if (!Capacitor.isPluginAvailable('LocalRoomProbe')) return;
        const status = await roomBridge.status();
        if (status.roomId !== roomJournal.roomId || status.finalizedAt) return;
        const remaining = Math.max(0, (status.participantCount ?? 0) - (status.finishedCount ?? 0));
        setHostCloseError('');
        setHostClosePrompt({ trainingId: sessionId, roomId: roomJournal.roomId, remaining });
      })().catch(() => { /* The room can be opened separately if the hotspot is unavailable. */ });
    }
  }

  function pulseNextRound() {
    if (pulse.current || !suggestRound || !preferences.animations || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    pulse.current = primary.current?.animate([
      { boxShadow: 'inset 0 0 0 0 transparent' },
      { boxShadow: '0 0 18px var(--accent-line), inset 0 0 0 3px var(--accent)', offset: .22 },
      { boxShadow: 'inset 0 0 0 0 transparent' },
    ], { duration: 950, easing: 'ease-out' }) ?? null;
    if (pulse.current) pulse.current.onfinish = () => { pulse.current = null; };
  }

  const error = (state.error || screenError) && <div role="alert" className="practice-error">
    {state.error || screenError}
    {!state.diary && <button type="button" onClick={() => window.location.reload()}>Повторить</button>}
  </div>;
  const offlineLabel = <span className="sr-only" role="status" data-testid="offline-status">
    {offline === 'ready' ? 'Готово офлайн' : offline === 'error' ? 'Офлайн недоступен' : 'Готовим офлайн'}
  </span>;

  function openTimer() {
    if (timer.prepare()) setTimerOpen(true);
    else setState(previous => ({ ...previous, error: 'Не удалось прочитать длительности таймера. Повтори открытие.' }));
  }

  const timerWindow = timerOpen && timer.settings && <PracticeTimerWindow state={timer.state} settings={timer.settings}
    onToggle={timer.toggle} onAdvance={timer.advance} onReset={timer.reset} onSelectPhase={timer.select} onSave={timer.save} onClose={() => setTimerOpen(false)} />;
  const notesWindow = notesScope && entry && <DiaryNotesSheet notes={entry.notes ?? []} scope={notesScope}
    includeConditionNotes={page === 'report'}
    readOnly={!!entry.deletedAt} onClose={() => setNotesScope(null)} onSave={notes => writeDiary(previous => ({
      ...previous, entries: previous.entries.map(item => item.id === entry.id ? { ...item, notes } : item),
    }))} />;
  const technique = setup ? setupMemo : practice.techniqueUses?.at(-1)?.selection ?? null;
  const techniqueWindow = techniqueOpen && <TechniqueWindow initial={memoSnapshot ?? technique} readOnly={completed || memoSnapshot !== null} onClose={() => { setTechniqueOpen(false); setMemoSnapshot(null); }}
    onPublication={publication => void recordPublication(publication)}
    onSelect={async selection => {
      if (setup) { setSetupMemo(selection); setTechniqueOpen(false); return true; }
      const success = await update(previous => bindTechnique(previous, selection));
      if (success) setTechniqueOpen(false);
      return success;
    }} />;
  const rankWindow = rankReference
    ? <RankReference initialBow={shownRank?.bow ?? null} initialCategory={rankCategory} onClose={() => setRankReference(false)} onProfile={openRankProfile} />
    : shownRank && <RankDetails rank={shownRank} onClose={() => setRankScope(null)}
      onOpenReference={() => setRankReference(true)}
      onProfile={openRankProfile}
      rankForCategory={category => rankScope ? (rankScope.kind === 'round' ? roundRank : seriesRank)(projectedPractice, rankScope.id, category) : shownRank} />;

  function openRankProfile() {
    if (page === 'report' || page === 'training' || page === 'editor' || page === 'best-ranks') {
      if (page === 'report' && sessionId) {
        reportPosition.current = { id: sessionId, position: captureReportPosition(document.querySelector('.report-body')) };
      }
      setRankProfileOrigin({ page, scope: rankScope, reference: rankReference });
    }
    setRankReference(false);
    setRankScope(null);
    setPage('profile');
  }
  function leaveProfile() {
    if (!rankProfileOrigin) { setPage('journal'); return; }
    setRankScope(rankProfileOrigin.scope);
    setRankReference(rankProfileOrigin.reference);
    setPage(rankProfileOrigin.page);
    setRankProfileOrigin(null);
  }

  const releaseNotes = <WebReleaseNotes seen={preferencesReadable ? preferences.webReleaseSeen : null}
    onSeen={webReleaseSeen => updatePreferences({ ...preferences, webReleaseSeen })}
    showHistory={releaseHistoryOpen} onCloseHistory={() => setReleaseHistoryOpen(false)} />;
  const grants = useMemo(() => {
    if (!state.diary) return [];
    const validity = achievementValidity(state.diary);
    const trashed = new Set(state.diary.entries.filter(item => item.deletedAt).map(item => item.id));
    return (state.diary.achievementLedger?.grants ?? [])
      .filter(grant => !grant.sessionId || !trashed.has(grant.sessionId) || !dependsOnTraining(grant.id))
      .map(grant => ({ ...grant, valid: validity.get(`${grant.id}:${grant.scope}`) ?? true }));
  }, [state.diary]);
  const validGrants = new Set(grants.filter(grant => grant.valid !== false).map(achievementReceiptKey));
  const pendingNotices = achievementQueue.map(moment => ({
    id: moment.id,
    groups: groupAchievementGrants(moment.grants.filter(grant => validGrants.has(achievementReceiptKey(grant)))),
  }));
  const activeNoticeIndex = pendingNotices.findIndex(moment => moment.groups.some(group =>
    [group.leading, ...group.additional].some(grant => !grant.notifiedAt)));
  const activeNotice = pendingNotices[activeNoticeIndex];
  const inputNoticesHidden = page === 'training' && preferences.showAchievementsDuringInput === false;
  const achievementNotice = activeNotice && preferences.showAchievementNotices !== false && !inputNoticesHidden && !(page === 'training' && preferences.hideScores) &&
    <AchievementNotice key={activeNotice.id} groups={activeNotice.groups} compact={page === 'training'}
      onShown={(shown: AchievementGrant[]) => writeDiary(previous => {
        if (!previous.achievementLedger) return previous;
        if (previous.achievementLedger.epoch !== state.diary?.achievementLedger?.epoch) return previous;
        const ids = new Set(shown.map(achievementReceiptKey));
        if (!previous.achievementLedger.grants.some(grant => ids.has(achievementReceiptKey(grant)) && !grant.notifiedAt)) return previous;
        return { ...previous, achievementLedger: { ...previous.achievementLedger, grants: previous.achievementLedger.grants.map(grant =>
          ids.has(achievementReceiptKey(grant)) && !grant.notifiedAt ? { ...grant, notifiedAt: new Date().toISOString() } : grant) } };
      })}
      onNext={() => setAchievementQueue(queue => queue.filter(moment => moment.id !== activeNotice.id))} />;
  const nextRecord = recordQueue[0];
  // The series editor's shot selector occupies the same space as the banners.
  const notice = page === 'editor' || (page === 'report' && finishHighlighting && finishMoment?.sessionId === sessionId) ? null
    : achievementNotice || (nextRecord && preferences.showAchievementNotices !== false && !preferences.hideScores &&
    <PersonalRecordNotice key={nextRecord.id} record={nextRecord}
      onShown={() => writeDiary(previous => ({
        ...previous,
        entries: previous.entries.map(item => item.id === nextRecord.sessionId ? {
          ...item, personalRecords: item.personalRecords?.map(record => record.id === nextRecord.id
            ? { ...record, notifiedAtMs: record.notifiedAtMs ?? Date.now() } : record),
        } : item),
      }))}
      onNext={() => setRecordQueue(queue => queue.slice(1))} />);

  const firstOnboarding = page === 'journal' && tab === 'home' && state.diary !== null && entries.length === 0 &&
    preferencesReadable && !preferences.onboardingSeen && !onboardingDismissed;
  const showingOnboarding = firstOnboarding || onboardingRequested || tutorialChapter !== null;
  const offerDefaultPush = !showingOnboarding && state.diary !== null && (
    page === 'journal' && tab === 'home' || page === 'conditions' && !entry && conditionsBack === 'journal');
  useEffect(() => {
    if (offerDefaultPush && releasePushSupported()) void releasePush.requestDefaultPermission()
      .catch(() => console.warn('Не удалось открыть системный запрос уведомлений.'));
  }, [offerDefaultPush]);
  const androidUpdates = useAndroidUpdates(!showingOnboarding && page === 'journal' && tab === 'home');
  async function leaveOnboarding() {
    if (preferencesReadable && !preferences.onboardingSeen) await updatePreferences({ ...preferences, onboardingSeen: true });
    setOnboardingDismissed(true);
    setOnboardingRequested(false);
    setTutorialChapter(null);
  }
  function leaveConditions() {
    setFutureConditions(false);
    setSetupMemo(null);
    setTournamentSetup(undefined);
    setRepeatSetup(null);
    setRoomSetup(null);
    setPage(conditionsBack);
  }
  function prepareTournament(setup: NonNullable<typeof tournamentSetup>) {
    setConfirmTournament(undefined); setTournamentSetup(setup); setSetupMemo(null);
    setSessionId(null); setConditionsBack('journal'); setPage('conditions');
  }
  useAppBack(showingOnboarding || page !== 'journal' || tab !== 'home', () => {
    if (targetGuide) { setTargetGuide(null); return; }
    if (showingOnboarding) { leaveOnboarding(); return; }
    switch (page) {
      case 'journal': setTab('home'); break;
      case 'group-room': setPage('journal'); break;
      case 'conditions': leaveConditions(); break;
      case 'report': leaveReport(); break;
      case 'editor':
        if (dirty) openConfirm('discard');
        else if (editing) setEdit(null);
        else closeSeriesEditor();
        break;
      case 'training':
        if (pendingShot) closeNumberPicker();
        else if (dirty) openConfirm('discard');
        else if (editing) setEdit(null);
        else leaveTraining();
        break;
      case 'archive': setPage(archiveBack); break;
      case 'statistics':
      case 'settings':
        if (settingsSection || page === 'statistics') {
          setSettingsSection(null);
          setPage('settings');
        } else setPage('journal');
        break;
      case 'best-ranks': setPage(ranksBack); break;
      case 'achievements':
      case 'notebook':
      case 'records': setPage('profile'); break;
      case 'profile': leaveProfile(); break;
      case 'tournaments': setPage(tournamentsBack); break;
    }
  });
  if (showingOnboarding) {
    return <>{offlineLabel}<WebOnboarding initialChapter={tutorialChapter ?? 'welcome'} offerPreferences={!preferences.onboardingSeen}
      onEnableHundredths={() => recordServiceAchievement('APP11')}
      onOpenTargetGuide={() => setTargetGuide('standard')}
      onClose={leaveOnboarding} onStart={async () => {
      await leaveOnboarding(); setSetupMemo(null); setConditionsBack('journal');
      if (ongoing) selectEntry(ongoing, 'conditions');
      else { setSessionId(null); setPage('conditions'); }
    }} onImport={async () => { await leaveOnboarding(); setPage('settings'); setMyTargetsOpen(true); }}
      onRestore={async () => { await leaveOnboarding(); setArchiveBack('journal'); setPage('archive'); }} />
      {targetGuide && <TargetGuide kind={targetGuide} onClose={() => setTargetGuide(null)} />}</>;
  }

  if (page === 'journal') return <JournalShell tab={tab} onTab={setTab} onSettings={() => setPage('settings')}
    displayName={displayName} avatar={googleAccount?.picture} onProfile={() => { setRankProfileOrigin(null); setPage('profile'); }}>
    {offlineLabel}
    {error}
    {tab === 'home' && <AndroidUpdateCard updates={androidUpdates} />}
    {tab === 'home' && importReceipt && <MyTargetsImportReceipt result={importReceipt} onClose={() => setImportReceipt(null)}
      onHistory={() => { setImportReceipt(null); setTab('history'); }} />}
    {tab === 'home' && state.diary && <JournalHome active={!!ongoing || !!paused} paused={!ongoing && !!paused} recent={recent}
      tournaments={tournaments} activeId={ongoing?.id ?? paused?.id}
      onTournament={({ item, days, starts, canContinue }) => {
        if (days > 0) { setTournamentPassportId(item.id); setTournamentsBack('journal'); setPage('tournaments'); return; }
        if (canContinue) { void startPractice(); return; }
        const setup = { tournamentId: item.id, startId: starts.length === 1 ? starts[0].id : undefined };
        if (ongoing) setConfirmTournament(setup);
        else prepareTournament(setup);
      }}
      practiceCount={recent.length} arrowCount={recent.reduce((total, item) => total +
        item.practice.rounds.reduce((count, round) => count + round.series.reduce((sum, end) => sum + end.shots.length, 0), 0), 0)}
      conditions={homeConditions}
      onHistory={() => setTab('history')}
      onEquipment={() => setTab('equipment')}
      onGroup={supportsLocalRoom() ? () => setPage('group-room') : undefined}
      needsEquipment={!ongoing && !paused && needsHomeEquipment} onStart={() => startPractice()} onOpen={openSaved}
      onConditions={() => {
        setSetupMemo(null);
        setConditionsBack('journal');
        if (ongoing) selectEntry(ongoing, 'conditions');
        else { setSessionId(null); setPage('conditions'); }
      }} />}
    {tab === 'history' && <JournalHistory entries={entries} filters={historyFilters} onFilters={setHistoryFilters} onOpen={openSaved}
      tournaments={tournaments} onTournaments={() => { setTournamentPassportId(null); setTournamentsBack('journal'); setPage('tournaments'); }} />}
    {confirmTournament && <BottomSheet title="Начать турнир?" onClose={() => setConfirmTournament(undefined)}>
      <p>Текущая тренировка будет приостановлена, когда ты начнёшь турнир.</p>
      <button type="button" className="primary" onClick={() => prepareTournament(confirmTournament)}>Перейти к условиям</button>
    </BottomSheet>}
    {tab === 'progress' && <JournalProgress entries={recent} onOpen={openSaved} onPractice={() => setTab('home')} view={progressView} onView={setProgressView} />}
    {tab === 'equipment' && <EquipmentCatalog history={recent} />}
    {releaseNotes}
    {notice}
  </JournalShell>;

  if (page === 'achievements') return <AchievementGallery grants={grants}
    progress={state.diary ? evaluateAchievementEvidence(eligibleForAchievements(state.diary), entry => entry.achievementEnrollment?.rankCategory ?? null) : []}
    availableRuleIds={[...ACHIEVEMENT_EVIDENCE_RULE_IDS, ...ACHIEVEMENT_ACTION_RULE_IDS, ...ROOM_ACHIEVEMENT_IDS, ...STAGE_RANK_RULES.map(rule => rule.id),
      'PROGRESS04', 'PROGRESS06', 'PROGRESS10']} onBack={() => setPage('profile')} />;
  if (page === 'records') return <>
    <PersonalRecordsScreen entries={recent} onBack={() => setPage('profile')} onOpen={id => openRecordReport(id, 'records')}
      onRanks={() => { setRanksBack('records'); setPage('best-ranks'); }} />
    {notice}
  </>;
  if (page === 'best-ranks') return <>
    <PersonalRanksScreen entries={recent} onBack={() => setPage(ranksBack)} onOpen={(id, roundId) => openRecordReport(id, 'best-ranks', roundId)} onProfile={openRankProfile} />
    {notice}
  </>;
  if (page === 'notebook') return <NotebookScreen entries={entries} notes={state.diary?.notes ?? []}
    onBack={() => setPage('profile')} onOpenSession={id => {
      const selected = entries.find(item => item.id === id && !item.deletedAt);
      if (!selected) return;
      setReportTrail([]);
      setReportBack('notebook');
      selectEntry(selected, 'report');
    }}
    onSaveStandalone={notes => writeDiary(previous => ({ ...previous, notes }))}
    onSaveSession={(id, notes) => writeDiary(previous => ({
      ...previous, entries: previous.entries.map(item => item.id === id ? { ...item, notes } : item),
    }))} />;
  if (page === 'tournaments') return <TournamentsScreen tournaments={tournaments} entries={entries} passportId={tournamentPassportId}
    onBack={() => setPage(tournamentsBack)} onSave={item => writeDiary(previous => saveTournament(previous, item))}
    onFinish={id => writeDiary(previous => finishTournament(previous, id))}
    onRemove={id => writeDiary(previous => ({ ...previous, tournaments: previous.tournaments?.filter(item => item.id !== id) }))}
    onOpenSession={id => {
      const selected = entries.find(item => item.id === id && !item.deletedAt);
      if (!selected) return;
      setReportTrail([]); setReportBack('tournaments'); selectEntry(selected, 'report');
    }} />;
  if (page === 'profile') return <><ProfileScreen entries={recent} grants={grants} onAchievements={() => setPage('achievements')}
    tournamentCount={tournaments.filter(item => item.starts.some(start => start.status === 'participated')).length}
    onTournaments={() => { setTournamentPassportId(null); setTournamentsBack('profile'); setPage('tournaments'); }}
    onNotebook={() => setPage('notebook')}
    onRecords={() => setPage('records')}
    onAchievement={recordServiceAchievement} onPublication={publication => void recordPublication(publication)}
    onBack={leaveProfile} focusRankCategory={!!rankProfileOrigin} onRanks={() => { setRanksBack('profile'); setPage('best-ranks'); }} />{notice}{error}</>;
  if (page === 'archive') return <><ArchiveScreen onBack={() => setPage(archiveBack)} restoreFirst={archiveBack === 'journal'} onAchievement={recordServiceAchievement} />{notice}{error}</>;
  if (page === 'group-room') return <main className="conditions-page settings-page">
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="Назад" onClick={() => setPage('journal')}><Icon name="back" /></button>
      <h1>Групповая тренировка</h1>
      <RoomHelpButton onClick={() => setRoomHelpOpen(true)} />
    </header>
    <div className="conditions-content settings-content">
      {roomHelpOpen && <RoomHelp onClose={() => setRoomHelpOpen(false)} />}
      <Suspense fallback={<p>Открываем комнаты…</p>}><LocalRoomProbe native={Capacitor.isPluginAvailable('LocalRoomProbe')}
        displayName={displayName}
        onTraining={state.diary ? enterRoomTraining : undefined}
        onFinalResults={async () => setHostResults(await finalizeHostedRoom())}
        unavailableReason={state.diary ? undefined : state.error || 'Сначала откройте дневник.'} /></Suspense>
      {hostResults && <GroupLeaderboard archived mySeries={1} saved={hostResults.history} title={hostResults.name}
        onClose={() => setHostResults(null)} />}
      {roomSwitch && <BottomSheet title={roomSwitch.roomName || 'Войти в комнату'} onClose={() => setRoomSwitch(null)}
        onDismissRequest={() => !joiningOwnTraining} tag="room-training-choice">
        {ongoing && !ongoing.groupRoomName && !ongoing.groupRoomHistory && !state.diary?.groupSeries?.some(item => item.trainingId === ongoing.id)
          ? <><p>В зачёт войдут все серии текущей тренировки, включая отстрелянные до входа. Начатая серия отправится после закрытия.</p>
            {roomPreviewSeries.length > 0 && <p>Готово к отправке · {roomPreviewSeries.length} сер. · {roomPreviewSeries.reduce((count, series) => count + series.shots.length, 0)} стрел</p>}
            <button type="button" className="primary" disabled={joiningOwnTraining}
              onClick={() => void joinWithOwnTraining(roomSwitch, ongoing.id)}>Войти с этой тренировкой</button></>
          : <p>Текущая тренировка уже участвует в другой комнате.</p>}
        <p>При выборе новой тренировки текущая встанет на паузу.</p>
        <button type="button" className="room-pill" disabled={joiningOwnTraining} onClick={() => prepareRoomTraining(roomSwitch)}>Начать новую</button>
        {state.error && <p role="alert">{state.error}</p>}
      </BottomSheet>}
    </div>
  </main>;
  const themeSettings = <WebThemeSettings value={preferences} disabled={!preferencesReadable}
    onChange={patch => updatePreferences({ ...preferences, ...patch })} />;
  const achievementPreference = <div className="preference-row"><span className="preference-title">Показывать достижения</span>
    <button type="button" role="switch" className="preference-switch" aria-label="Показывать достижения" aria-checked={preferences.showAchievementNotices !== false}
      disabled={!preferencesReadable} onClick={async () => {
        const enabled = preferences.showAchievementNotices === false;
        if (await updatePreferences({ ...preferences, showAchievementNotices: enabled }) && !enabled) {
          setAchievementQueue([]);
          setRecordQueue([]);
        }
      }}><span /></button></div>;
  if (page === 'settings' || page === 'statistics') return <SettingsScreen
    section={page === 'statistics' ? 'statistics' : settingsSection}
    onSection={section => { setSettingsSection(section); setPage('settings'); }}
    onBack={() => { setSettingsSection(null); setPage('journal'); }}
    appearance={<>
      {themeSettings}
      <div className="settings-panel"><TrainingPreferenceControls keys={['colorTrainingBorders']} /></div>
      <RecentPracticeLimitControl />
      {supportsAppScale() && <div className="settings-panel"><TrainingPreferenceControls keys={['useSystemScale']} /></div>}
    </>}
    motion={<div className="settings-panel">
      <TrainingPreferenceControls keys={['animations', 'celebrationEffects', 'haptics']} />
      {achievementPreference}
    </div>}
    training={<div className="settings-panel"><LensControls preview={<LensTestTarget onAchievement={recordServiceAchievement} />} /><TrainingPreferenceControls keys={['keepAwake', 'trainingOnLockScreen', 'hideScores', 'showAchievementsDuringInput']} /><TripleTargetControls /></div>}
    statistics={<>
      <div className="settings-panel"><TrainingPreferenceControls keys={['averageHundredths', 'maximumSpread']} onEnableHundredths={() => recordServiceAchievement('APP11')} /></div>
      <SettingsAction icon="podium" aria-haspopup="dialog" onClick={() => setRankReference(true)}>Разрядная сетка</SettingsAction>
      <StatisticsSettings />
    </>}
    data={<>
      <div className="settings-actions">
        <SettingsAction icon="archive" data-testid="settings-archive" onClick={() => { setArchiveBack('settings'); setPage('archive'); }}>Резервная копия</SettingsAction>
        <SettingsAction icon="download" data-testid="settings-mytargets" aria-haspopup="dialog" onClick={() => setMyTargetsOpen(true)}>Импорт MyTargets</SettingsAction>
      </div>
      <SettingsAction icon="undo" tone="danger" aria-haspopup="dialog" onClick={() => setAchievementResetOpen(true)}
        disabled={!state.diary?.achievementLedger}>Обнулить достижения</SettingsAction>
    </>}
    help={<div className="settings-actions">
      <SettingsAction icon="book" data-testid="settings-onboarding" onClick={() => setOnboardingRequested(true)}>Знакомство с FableShot</SettingsAction>
      <SettingsAction icon="spark" data-testid="help-quick-preferences" onClick={() => setTutorialChapter('preferences')}>Быстрые настройки</SettingsAction>
      <SettingsAction icon="help" data-testid="help-tutorial" onClick={() => setTutorialChapter('target')}>Как отмечать попадания</SettingsAction>
      <SettingsAction icon="help" data-testid="help-standard-target" onClick={() => setTargetGuide('standard')}>Одинарная мишень</SettingsAction>
      <SettingsAction icon="help" data-testid="help-triple-target" onClick={() => setTargetGuide('triple')}>Мишень «Светофор»</SettingsAction>
      <SettingsAction icon="stats" data-testid="help-report-tutorial" onClick={() => setTutorialChapter('report')}>Как читать статистику</SettingsAction>
    </div>}
    notifications={releasePushSupported() ? <ReleasePushSettings /> : undefined}
    about={<AboutScreen onReleaseNotes={() => setReleaseHistoryOpen(true)} updates={androidUpdates} />}>
    {offlineLabel}
    {rankWindow}
    {myTargetsOpen && <MyTargetsImport onClose={() => setMyTargetsOpen(false)} />}
    {releaseHistoryOpen && releaseNotes}
    {notice}
    {targetGuide && <TargetGuide kind={targetGuide} onClose={() => setTargetGuide(null)} />}
    {achievementResetOpen && <BottomSheet title="Обнулить достижения?" onClose={() => setAchievementResetOpen(false)}>
      <p>Тренировки останутся в истории. Достижения начнут начисляться с новых занятий.</p>
      <button type="button" className="primary" data-testid="achievement-reset-confirm" onClick={async () => {
        if (await writeDiary(diary => ({ ...diary, achievementLedger: { epoch: crypto.randomUUID(), grants: [] } }))) {
          setAchievementQueue([]); setAchievementResetOpen(false);
        }
      }}>Обнулить</button>
      {error}
    </BottomSheet>}
  </SettingsScreen>;

  if (page === 'conditions') return <>
    {offlineLabel}
    <ConditionsScreen key={setup ? 'setup' : !hasHits || futureConditions ? 'future' : 'correction'}
      initial={setup ? newConditions : active.series.conditions} rule={setup ? setupDefaults.rule : practice.roundRule} editableRule={setup || !hasHits && practice.savedAt === null}
      correction={!setup && hasHits && !futureConditions ? practice : undefined}
      onFuture={!setup && !futureConditions && conditionsBack === 'training' && hasHits ? () => setFutureConditions(true) : undefined}
      onCorrection={async (source, proposed) => {
        const success = await update(previous => {
          if (source !== previous) throw new Error('Тренировка изменилась. Проверь условия ещё раз.');
          if (proposed === previous || practice.savedAt !== null || !entry || entry.id === 'pilot' || entry.paused || roomJournal) return proposed;
          const current = currentSeries(proposed)?.series;
          if (!current || current.progressBaselineId !== undefined || current.shots.length) return proposed;
          return attachProgressBaseline(proposed, freezeProgressBaseline(diaryRef.current?.entries ?? [], entry.id,
            entry.startedAt, current.conditions, new Date().toISOString()));
        }, false, true, true);
        if (success) {
          leaveConditions();
        }
        return success;
      }}
      achievementPreference={achievementPreference}
      initialNumbering={setup ? setupDefaults.numberedArrows : practice.numberedArrows ?? null}
      onTechnique={() => setTechniqueOpen(true)} techniqueTitle={technique?.title ?? 'Не выбрана'}
      tournaments={setup ? tournaments : undefined}
      tournamentSetup={setup ? tournamentSetup : undefined}
      trainingTitles={setup ? frequentTrainingTitles(recent) : undefined}
      onBack={leaveConditions} onApply={async (conditions, rule, numberedArrows, tournament, title) => {
        if (setup) {
          return startPractice(conditions, rule, numberedArrows, tournament, title);
        }
        const success = await update(previous => {
          const next = applyConditions(previous, conditions, hasHits ? undefined : rule, numberedArrows);
          const applied = currentSeries(next)?.series.conditions;
          // The earliest pilot used a synthesized start date for an open practice.
          if (!entry || entry.id === 'pilot' || !applied || applied === currentSeries(previous)?.series.conditions) return next;
          return attachProgressBaseline(next, freezeProgressBaseline(diaryRef.current?.entries ?? [], entry.id,
            entry.startedAt, applied, new Date().toISOString()));
        }, true);
        if (success) { setSelection(null); leaveConditions(); }
        return success;
      }} />
    {error}
    {techniqueWindow}
  </>;

  if (page === 'report') return <>
    {offlineLabel}
    {hostClosePrompt?.trainingId === sessionId && !entry?.groupRoomHistory?.finalizedAt && <BottomSheet
      title="Подвести итоги?" tag="host-close-room" onClose={() => setHostClosePrompt(null)} onDismissRequest={() => !hostClosing}>
      {hostClosePrompt.remaining > 0 && <p>Ждём завершения · {hostClosePrompt.remaining}</p>}
      <p>После закрытия участники больше не смогут обновлять результат в комнате. В итогах останутся уже полученные серии.</p>
      <button type="button" className="primary" disabled={hostClosing} onClick={async () => {
        setHostClosing(true);
        setHostCloseError('');
        try {
          await finalizeHostedRoom(hostClosePrompt.roomId);
          setHostClosePrompt(null);
          setRoomLeaderboardOpen(true);
        } catch (cause) {
          setHostCloseError(cause instanceof Error ? cause.message : 'Не удалось закрыть комнату.');
        } finally { setHostClosing(false); }
      }}>Закрыть комнату</button>
      <button type="button" className="room-pill" disabled={hostClosing} onClick={() => setHostClosePrompt(null)}>Оставить открытой</button>
      {hostCloseError && <p role="alert">{hostCloseError}</p>}
    </BottomSheet>}
    {entry?.groupRoomHistory && roomLeaderboardOpen && <GroupLeaderboard archived entryId={roomJournal?.entryId} mySeries={lastClosedRoomSeries}
      saved={entry.groupRoomHistory} title={entry.groupRoomName} onClose={() => setRoomLeaderboardOpen(false)}
      onRefresh={roomJournal && !entry.groupRoomHistory.finalizedAt && !entry.deletedAt && supportsLocalRoom() ? async () => {
        const membership = loadRoomMembership(roomJournal.entryId);
        if (!membership || membership.roomId !== roomJournal.roomId) throw new Error('Приглашение недоступно.');
        return refreshRoomHistory(entry.id, membership, true);
      } : undefined} />}
    <ReportOverview key={sessionId} practice={practice} entries={entries} entryId={sessionId} onBack={leaveReport} onSelectSeries={openSeriesEditor}
      navigation={(reportIndex >= 0 && recent.length > 1) || reportPosition.current?.id === sessionId ? {
        previous: reportIndex >= 0 ? recent[reportIndex + 1]?.id : undefined, next: reportIndex >= 0 ? recent[reportIndex - 1]?.id : undefined,
        position: reportPosition.current?.id === sessionId ? reportPosition.current?.position : undefined,
        open: (id, position) => {
          const neighbor = recent.find(item => item.id === id);
          if (!neighbor) return;
          reportPosition.current = { id, position };
          selectEntry(neighbor, 'report');
        },
        restored: () => { reportPosition.current = null; },
      } : undefined}
      onCorrectConditions={entry && !entry.deletedAt ? () => {
        setFutureConditions(false); setConditionsBack('report'); setPage('conditions');
      } : undefined}
      moment={finishMoment?.sessionId === sessionId ? finishMoment?.moment : undefined}
      onRoomLeaderboard={entry?.groupRoomHistory ? () => setRoomLeaderboardOpen(true) : undefined}
      roomFinalized={!!entry?.groupRoomHistory?.finalizedAt}
      onPause={pauseEntry}
      onRepeat={!ongoing && entry && !entry.deletedAt ? () => {
        setSetupMemo(null);
        setRepeatSetup(trainingSetup(entry.practice));
        setConditionsBack('report');
        setPage('conditions');
      } : undefined}
      onDeleteStage={(kind, id) => update(previous => kind === 'round' ? deleteRound(previous, id) : deleteSeries(previous, id), false, true)}
      onOpenRecordSession={id => openRecordReport(id, 'report')}
      onAchievement={id => recordServiceAchievement(id, sessionId ?? undefined)}
      grants={grants.filter(grant => grant.sessionId === sessionId)}
      onNotes={setNotesScope}
      onRename={async title => !!entry && writeDiary(previous => renameDiaryEntry(previous, entry.id, title))}
      onTrash={async deleted => {
        if (!entry) return false;
        return writeDiary(previous => setDiaryDeleted(previous, entry.id, deleted), deleted ? entry.id : undefined, deleted);
      }}
      onRank={id => setRankScope({ kind: 'round', id })} onRankReference={() => setRankReference(true)} onRankProfile={openRankProfile}
      onTechnique={() => setTechniqueOpen(true)}
      onChange={next => update(() => next)} onOpenMemo={selection => { setMemoSnapshot(selection); setTechniqueOpen(true); }}
      onResume={() => {
        if (ongoing && ongoing.id !== sessionId) {
          setState(previous => ({ ...previous, error: 'Сначала заверши активную тренировку.' }));
          return;
        }
        if (entry) resumeEntry(entry);
      }} />
    {error}
    {timerWindow}
    {techniqueWindow}
    {notesWindow}
    {notice}
    {rankWindow}
  </>;

  const numberTarget = pendingShot ?? (numberEditOpen ? editing : null);

  return <main className="practice" data-testid={seriesEditor ? 'history-shot-editor' : 'training-screen'}>
    {offlineLabel}
    <header className="topbar">
      <button type="button" className="icon-button"
        aria-label={editing ? 'Удалить попадание' : seriesEditor ? 'Закрыть редактор' : completed ? 'К статистике' : hasHits ? 'Завершить тренировку' : 'На главную'}
        onClick={() => {
          if (editing) openConfirm('delete');
          else if (seriesEditor) closeSeriesEditor();
          else leaveTraining();
        }}>
        <Icon name={editing ? 'delete' : completed ? 'back' : 'close'} />
      </button>
      {seriesEditor ? <div className="series-editor-heading">
        <h1>{editing ? `Стрела ${editing.index + 1}` : 'Редактор серии'}</h1>
        <span>Раунд {practice.rounds.indexOf(round) + 1} · серия {round.series.indexOf(series) + 1}</span>
      </div> : <div className="series-editor-heading">
        {achievementNotice || <h1>{editing ? `Стрела ${editing.index + 1}` : 'Тренировка'}</h1>}
        {roomJournal && <output className="room-sync-status" aria-live="polite" data-testid="room-sync-status">
          {entry?.groupRoomHistory?.finalizedAt ? 'Итоги зафиксированы' : pendingRoomCount ? `В очереди · ${pendingRoomCount}` : 'Групповая'}
        </output>}
      </div>}
      {seriesEditor && <button type="button" className="icon-button" aria-label="Заметки серии"
        onClick={async () => { if (await saveEdit(true)) setNotesScope({ seriesId: series.id }); }}><Icon name="notes" /></button>}
      {!seriesEditor && <>
      {roomJournal && <button type="button" className="icon-button" aria-label="Таблица комнаты" onClick={async () => {
        if (await saveEdit()) setRoomLeaderboardOpen(true);
      }}><Icon name="group" /></button>}
      <button type="button" className="icon-button" aria-label="Памятка и фокус" data-testid="training-technique-open"
        onClick={async () => { if (await saveEdit()) setTechniqueOpen(true); }}><Icon name="notes" /></button>
      <button type="button" className="icon-button" aria-label="Условия тренировки" disabled={past || completed || !entry}
        onClick={async () => { if (await saveEdit()) { setConditionsBack('training'); setPage('conditions'); } }}><Icon name="settings" /></button>
      <button type="button" className="icon-button" aria-label="Статистика" disabled={!hasHits}
        onClick={async () => { if (await saveEdit()) { if (!completed) setReportBack('training'); setPage('report'); } }}><Icon name="stats" /></button>
      </>}
    </header>
    {roomJournal && roomLeaderboardOpen && <GroupLeaderboard key={roomJournal.entryId} entryId={roomJournal.entryId}
      saved={entry?.groupRoomHistory} title={entry?.groupRoomName}
      onFinalSnapshot={(history, name) => { if (sessionId) saveRoomHistory(sessionId, history, name); }}
      mySeries={lastClosedRoomSeries}
      myOpenSeries={practice.savedAt === null ? roomJournal.ends.length + 1 : undefined}
      onClose={() => setRoomLeaderboardOpen(false)} />}
    {!seriesEditor && <TrainingSummary roundNumber={practice.rounds.indexOf(round) + 1}
      roundEmphasis={newRoundMotion?.session === sessionId && newRoundMotion.round === round.id ? round.id : undefined}
      seriesNumber={`${round.series.indexOf(series) + 1}${practice.roundRule.unit === 'series' ? `/${practice.roundRule.limit}` : ''}`}
      roundShots={roundShown} seriesShots={shots} onRound={() => openPicker('round')} onSeries={() => openPicker('series')}
      roundRank={currentRanks && <RankTag rank={currentRanks.round} testId="rank-round" onOpen={() => setRankScope({ kind: 'round', id: round.id })} />}
      seriesRank={currentRanks && <RankTag rank={currentRanks.series} testId="rank-series" onOpen={() => setRankScope({ kind: 'series', id: series.id })} />} />}
    <TrainingShotStrip key={series.id} shots={shots} previousVolume={previousVolume} selected={editing?.index ?? null}
      entering={!editing && canAppend ? shots.length : null} onPick={chooseShot}
      feedback={activeShotFeedback} direction={seriesTransition?.id === series.id ? seriesTransition.direction : undefined}
      removing={activeRemovedMarker?.index} />
    {lensSettingsOpen && <BottomSheet title="Лупа" onClose={() => setLensSettingsOpen(false)} tag="training-lens-settings">
      <LensControls preview={<LensTestTarget onAchievement={recordServiceAchievement} />} />
    </BottomSheet>}
    <TargetBoard key={`${seriesEditor ? 'editor' : 'training'}-${series.id}-${targetSpec.profileId}-${targetSpec.diameterMm}`} shots={shots} spec={targetSpec} selectedIndex={editing?.index ?? null}
      onOpenLensSettings={() => setLensSettingsOpen(true)}
      realArrowDiameter={targetSpec.shaftDiameterMm}
      zoomScope={seriesEditor ? 'editor' : 'training'}
      spotNavigation={isTripleTarget && !seriesEditor ? { spot: focusedSpot, onSpot: focusSpot, disabled: !!pendingShot } : undefined}
      onOpenGuide={!seriesEditor && !pendingShot ? () => { acknowledgeTargetGuide(); setTargetGuide(guideKind); } : undefined}
      highlightGuide={!preferences.seenTargetGuide?.[guideKind]}
      inputEnabled={canInput} panOnly={seriesEditor && !editing} onShot={mark}
      feedback={activeShotFeedback}
      removed={activeRemovedMarker}
      onBlockedTap={suggestRound ? pulseNextRound : undefined} />
    {error}
    <TrainingFooter mainText={mainText} newRound={nextIsRound} showPrevious={!seriesEditor}
      onPrevious={!seriesEditor && !editing && !pendingShot && position > 0 ? () => showSeries(seriesIds[position - 1]) : undefined}
      mainEnabled={!!entry && !pendingShot && (seriesEditor ? dirty : editing !== null || completed || past || shots.length > 0 || roundFull)}
      mainRef={primary} onMain={mainAction} missEnabled={canInput} onMiss={() => mark(miss)}
      timerBadge={!seriesEditor && !completed && <PracticeTimerBadge state={timer.state} onOpen={openTimer} />}
      status={seriesEditor ? editing ? `${editing.shot.points} очков` : 'Выбери стрелу' : undefined}
      arrowNumberChoice={editing && (arrowCount > 0 || editing.shot.physicalArrowNumber !== undefined) && <button type="button"
        className="physical-arrow-edit" data-testid="physical-arrow-choice" onClick={() => setNumberEditOpen(true)}
        aria-label={`Физическая стрела · ${editing.shot.physicalArrowNumber ?? 'без номера'}`}>
        № {editing.shot.physicalArrowNumber ?? '—'}
      </button>}
      undoEnabled={!pendingShot && (seriesEditor ? dirty : editing !== null || (!completed && !past && shots.length > 0))} onUndo={undo} />
    {numberTarget && <PhysicalArrowPicker count={arrowCount} selected={numberTarget.shot.physicalArrowNumber}
      used={usedArrowNumbers(shots, numberTarget.index)} error={numberSaveError}
      onChoose={chooseArrowNumber} onClose={closeNumberPicker} />}
    {picker && <StagePicker kind={picker} practice={practice} roundId={round.id} seriesId={series.id}
      onChoose={showSeries} onClose={() => setPicker(null)}
      onNewRound={async () => {
        const saved = await update(startRound);
        if (saved) { setSelection(null); afterRoundCreated(); }
        return saved;
      }}
      onDelete={async id => {
        const saved = await update(previous => picker === 'round' ? deleteRound(previous, id) : deleteSeries(previous, id), false, true);
        if (saved && !diaryRef.current?.entries.some(item => item.id === sessionId)) setPage('journal');
        return saved;
      }} />}
    {timerWindow}
    {targetGuide && <TargetGuide kind={targetGuide} onClose={() => setTargetGuide(null)} />}
    {techniqueWindow}
    {rankWindow}
    {notesWindow}
    {!achievementNotice && notice}
    <dialog ref={confirmDialog} className="confirm" aria-labelledby="confirm-title">
      <form method="dialog">
        <h2 id="confirm-title">{confirm === 'discard' ? 'Отменить правки?' : confirm === 'delete' ? 'Удалить попадание?' : 'Завершить тренировку?'}</h2>
        <div className={`confirm-actions${confirm === 'finish' ? ' confirm-actions-stacked' : ''}`}>
          <button type="submit" autoFocus>Отмена</button>
          {confirm === 'finish' && <button type="submit" onClick={() => { setTab('home'); setPage('journal'); }}>На главную</button>}
          <button type="submit" className="primary" data-testid="training-confirm" onClick={confirmAction}>
            {confirm === 'discard' ? 'Отменить правки' : confirm === 'delete' ? 'Удалить' : 'Завершить'}
          </button>
        </div>
      </form>
    </dialog>
  </main>;
}

const root = createRoot(document.getElementById('root')!);
withStorageOwner(async () => {
  await initializeAppStorage(isDiary);
  root.render(<StrictMode><TrainingPreferencesProvider><TechniqueSettingsProvider><App /></TechniqueSettingsProvider></TrainingPreferencesProvider></StrictMode>);
},
  message => root.render(<main className="conditions-page"><div className="conditions-content"><h1>Дневник защищён</h1><p role="alert">{message}</p><button type="button" onClick={() => window.location.reload()}>Повторить</button></div></main>));
