import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReportOverview } from './ReportOverview.tsx';
import { BottomSheet, ConditionsScreen } from './ConditionsScreen.tsx';
import { PracticeTimerBadge, PracticeTimerWindow } from './PracticeTimerWindow.tsx';
import { usePracticeTimer } from './usePracticeTimer.ts';
import { performTrainingHaptic } from './native-training-window.ts';
import { TrainingPreferenceControls, TrainingPreferencesProvider, useTrainingPreferences, useKeepScreenOn } from './TrainingPreferences.tsx';
import { TechniqueWindow } from './TechniqueWindow.tsx';
import type { TechniqueSelection } from './technique.ts';
import { TechniqueSettingsProvider } from './TechniqueSettings.tsx';
import { StagePicker } from './StagePicker.tsx';
import { TargetBoard } from './TargetBoard.tsx';
import { Icon, TrainingFooter, TrainingSummary } from './TrainingChrome.tsx';
import { JournalHome, JournalShell } from './JournalShell.tsx';
import type { JournalTab } from './JournalShell.tsx';
import { JournalHistory, JournalProgress } from './JournalTabs.tsx';
import { EquipmentCatalog } from './EquipmentCatalog.tsx';
import { ProfileScreen } from './ProfileScreen.tsx';
import { WebReleaseNotes } from './WebReleaseNotes.tsx';
import { AboutScreen } from './AboutScreen.tsx';
import { WebOnboarding } from './WebOnboarding.tsx';
import { WebThemeSettings } from './WebThemeSettings.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';
import type { SettingsSection } from './SettingsScreen.tsx';
import { AchievementGallery } from './AchievementGallery.tsx';
import { AchievementNotice } from './AchievementNotices.tsx';
import { PersonalRecordNotice } from './PersonalRecordCard.tsx';
import { PersonalRecordsScreen } from './PersonalRecordsScreen.tsx';
import { PersonalRanksScreen } from './PersonalRanksScreen.tsx';
import { calculatePersonalRecordEvents } from './personal-record-events.ts';
import type { PersonalRecordEvent } from './personal-record-events.ts';
import { groupAchievementGrants, queueAchievementGrants, recentAchievementNotices } from './achievement-ledger.ts';
import type { AchievementGroup } from './achievement-ledger.ts';
import { ACHIEVEMENT_ACTION_RULE_IDS, awardPublication, awardServiceAction, awardTrainingChange, eligibleForAchievements } from './achievement-diary.ts';
import type { AchievementActionId } from './achievement-diary.ts';
import { achievementValidity } from './achievement-validity.ts';
import { ACHIEVEMENT_EVIDENCE_RULE_IDS, evaluateAchievementEvidence } from './achievement-evidence.ts';
import { DiaryNotesSheet } from './DiaryNotesSheet.tsx';
import { NotebookScreen } from './NotebookScreen.tsx';
import type { DiaryNoteScope } from './diary-notes.ts';
import { compareDiaryDate, DEFAULT_HISTORY_FILTERS, setDiaryDeleted } from './diary-history.ts';
import { startTrainingTime, stopTrainingTime } from './training-time.ts';
import { equipmentSnapshot, loadEquipment } from './equipment.ts';
import { PhysicalArrowPicker } from './PhysicalArrowPicker.tsx';
import { RankDetails, RankReference, RankTag } from './SportRanks.tsx';
import { roundRank, seriesRank } from './sport-ranks.ts';
import { freezeProgressBaseline } from './progress-scoring.ts';
import { StatisticsSettings } from './StatisticsSettings.tsx';
import { ArchiveScreen } from './ArchiveScreen.tsx';
import { MyTargetsImport } from './MyTargetsImport.tsx';
import { withStorageOwner } from './storage-owner.ts';
import { statisticVisible } from './statistics-visibility.ts';
import { enableOffline } from './offline.ts';
import { loadDiary, saveDiary } from './persistence.ts';
import type { Diary, DiaryEntry } from './persistence.ts';
import { advanceSeries, appendShot, applyConditions, attachProgressBaseline, bindTechnique, completePractice, currentSeries, deleteRound, deleteSeries,
  emptyPractice, findSeries, isRoundFull, removeShot, replaceShot, resumePractice,
  startRound, usedArrowNumbers } from './practice.ts';
import type { Practice } from './practice.ts';
import type { Shot } from './target.ts';
import type { Conditions, RoundRule } from './conditions.ts';
import './style.css';

type Edit = { seriesId: number; index: number; shot: Shot };
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
  const { preferences, readable: preferencesReadable, update: updatePreferences } = useTrainingPreferences();
  const [state, setState] = useState(initialDiary);
  const diaryRef = useRef(state.diary);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<JournalTab>('home');
  const [page, setPage] = useState<'journal' | 'training' | 'editor' | 'report' | 'conditions' | 'settings' | 'statistics' | 'archive' | 'profile' | 'achievements' | 'records' | 'best-ranks' | 'notebook'>('journal');
  const [myTargetsOpen, setMyTargetsOpen] = useState(false);
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [onboardingRequested, setOnboardingRequested] = useState(false);
  const [tutorialRequested, setTutorialRequested] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [achievementResetOpen, setAchievementResetOpen] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState<AchievementGroup[]>(() =>
    preferences.showAchievementNotices === false ? [] : recentAchievementNotices(state.diary?.achievementLedger));
  const [recordQueue, setRecordQueue] = useState<PersonalRecordEvent[]>(() => {
    if (preferences.showAchievementNotices === false || preferences.hideScores) return [];
    const now = Date.now();
    return state.diary?.entries.filter(entry => !entry.deletedAt && !entry.nativeArchiveSession).flatMap(entry =>
      entry.personalRecords?.filter(record => record.notifiedAtMs === null &&
        record.recordedAtMs <= now && now - record.recordedAtMs <= 10_000) ?? []) ?? [];
  });
  const [reportBack, setReportBack] = useState<'journal' | 'training' | 'profile' | 'records' | 'best-ranks' | 'notebook'>('journal');
  const [ranksBack, setRanksBack] = useState<'records' | 'profile'>('records');
  const [reportTrail, setReportTrail] = useState<string[]>([]);
  const [conditionsBack, setConditionsBack] = useState<'journal' | 'training'>('training');
  const [setupMemo, setSetupMemo] = useState<TechniqueSelection | null>(null);
  const [historyFilters, setHistoryFilters] = useState(DEFAULT_HISTORY_FILTERS);
  const [notesScope, setNotesScope] = useState<DiaryNoteScope | null>(null);
  const [postHit, setPostHit] = useState<Edit | null>(null);
  const [postHitReady, setPostHitReady] = useState(false);
  const [numberEditOpen, setNumberEditOpen] = useState(false);
  const [numberSaveError, setNumberSaveError] = useState(false);
  const [rankScope, setRankScope] = useState<{ kind: 'round' | 'series'; id: number } | null>(null);
  const [rankReference, setRankReference] = useState(false);
  const [selection, setSelection] = useState<number | null>(null);
  const editorReturnSelection = useRef<number | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [picker, setPicker] = useState<'round' | 'series' | null>(null);
  const [confirm, setConfirm] = useState<'finish' | 'delete' | 'discard'>('finish');
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const pulse = useRef<Animation | null>(null);
  const [offline, setOffline] = useState<'pending' | 'ready' | 'error'>('pending');
  const [timerOpen, setTimerOpen] = useState(false);
  const [techniqueOpen, setTechniqueOpen] = useState(false);
  const [memoSnapshot, setMemoSnapshot] = useState<TechniqueSelection | null>(null);

  useEffect(() => {
    let alive = true;
    enableOffline().then(() => {
      if (alive) setOffline('ready');
    }, () => {
      if (alive) setOffline('error');
    });
    return () => { alive = false; };
  }, []);

  function writeDiary(change: (previous: Diary) => Diary, trainingId?: string): boolean {
    const previous = diaryRef.current;
    if (!previous) return false;
    try {
      const proposed = change(previous);
      if (proposed === previous) return true;
      const awarded = trainingId ? awardTrainingChange(previous, proposed, trainingId, preferences.rankCategory ?? null, new Date().toISOString())
        : { diary: proposed, added: [] };
      let next = awarded.diary;
      let newRecords: PersonalRecordEvent[] = [];
      if (trainingId) {
        const before = previous.entries.find(entry => entry.id === trainingId);
        const current = next.entries.find(entry => entry.id === trainingId);
        if (before && current && !before.practice.savedAt && current.practice.savedAt && current.personalRecords === undefined) {
          newRecords = calculatePersonalRecordEvents(current, previous.entries, preferences.rankCategory ?? null, Date.parse(current.practice.savedAt));
          if (preferences.showAchievementNotices === false || preferences.hideScores) {
            newRecords = newRecords.map(record => ({ ...record, notifiedAtMs: record.recordedAtMs }));
          }
          next = { ...next, entries: next.entries.map(entry => entry.id === trainingId ? { ...entry, personalRecords: newRecords } : entry) };
        }
      }
      const known = new Set(previous.achievementLedger?.grants.map(grant => `${grant.id}:${grant.scope}`));
      const added = next.achievementLedger?.grants.filter(grant => !known.has(`${grant.id}:${grant.scope}`)) ?? [];
      if (added.length && preferences.showAchievementNotices === false && next.achievementLedger) next = { ...next,
        achievementLedger: { ...next.achievementLedger, grants: next.achievementLedger.grants.map(grant =>
          known.has(`${grant.id}:${grant.scope}`) ? grant : { ...grant, notifiedAt: new Date().toISOString() }) } };
      saveDiary(next, previous);
      diaryRef.current = next;
      setState({ diary: next, error: '' });
      if (added.length && preferences.showAchievementNotices !== false) {
        setAchievementQueue(queue => queueAchievementGrants(queue, added));
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

  async function recordPublication({ documentId, content }: { documentId: string; content: string }) {
    const epoch = diaryRef.current?.achievementLedger?.epoch;
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
      const fingerprint = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
      writeDiary(previous => previous.achievementLedger?.epoch === epoch
        ? awardPublication(previous, documentId, fingerprint, new Date().toISOString()) : previous);
    } catch (cause) { setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'Не удалось сохранить достижение памятки.' })); }
  }

  function update(change: (previous: Practice) => Practice, rememberSetup = false): boolean {
    return writeDiary(previous => {
      const entry = previous.entries.find(item => item.id === sessionId);
      if (!entry) return previous;
      let practice = change(entry.practice);
      if (practice === entry.practice) return rememberSetup ? { ...previous, lastSetup: trainingSetup(practice) } : previous;
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
      return { ...previous, ...(rememberSetup && { lastSetup: trainingSetup(practice) }), entries: previous.entries.flatMap(item => item.id !== entry.id ? [item]
        : remove && !notes?.length ? [] : [{ ...item, practice,
          ...(entry.practice.savedAt !== null && practice.savedAt === null && item.personalRecords === undefined ? { personalRecords: [] } : {}),
          ...(notes ? { notes } : {}), ...(trainingTime ? { trainingTime } : {}) }]) };
    }, sessionId ?? undefined);
  }

  function saveEdit(keepSelection = false): boolean {
    if (!edit) return true;
    if (!update(previous => replaceShot(previous, edit.seriesId, edit.index, edit.shot))) return false;
    if (!keepSelection) setEdit(null);
    return true;
  }

  function showSeries(seriesId: number) {
    if (!saveEdit()) return;
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
  const entry = entries.find(item => item.id === sessionId);
  const ongoing = entries.find(item => item.practice.savedAt === null && !item.paused && !item.deletedAt);
  const paused = entries.filter(item => item.paused && !item.deletedAt).sort(compareDiaryDate)[0];
  const recent = useMemo(() => entries.filter(item => item.practice.savedAt !== null && !item.deletedAt)
    .sort(compareDiaryDate), [entries]);
  const initial = useMemo(emptyPractice, []);
  const practice = entry?.practice ?? initial;
  const setup = !entry && page === 'conditions';
  const suggested = state.diary?.lastSetup ?? trainingSetup((ongoing ?? paused ?? recent[0])?.practice ?? initial);
  let newConditions = suggested.conditions;
  let needsHomeEquipment = false;
  if (!ongoing && suggested.conditions.equipment && ((page === 'journal' && tab === 'home') || setup)) {
    try {
      const currentKit = equipmentSnapshot(loadEquipment(), suggested.conditions.equipment.id);
      newConditions = { ...suggested.conditions, equipment: currentKit };
      needsHomeEquipment = !currentKit;
    } catch {
      // Conditions can still open so the equipment picker can show its read error.
      newConditions = { ...suggested.conditions, equipment: null };
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
    setSessionId(item.id);
    setSelection(null);
    setEdit(null);
    setPage(next);
  }

  function startPractice(conditions?: Conditions, rule = suggested.rule, numberedArrows = suggested.numberedArrows) {
    if (ongoing) { selectEntry(ongoing, 'training'); return true; }
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
      achievementEnrollment: { epoch: achievementLedger.epoch, rankCategory: preferences.rankCategory ?? null } };
    if (!writeDiary(previous => ({ ...previous, achievementLedger, lastSetup: trainingSetup(next), entries: [...previous.entries, item] }))) return false;
    setSetupMemo(null);
    selectEntry(item, 'training');
    return true;
  }

  function openSaved(id: string) {
    const item = entries.find(candidate => candidate.id === id);
    if (!item) return;
    setReportTrail([]);
    setReportBack('journal');
    selectEntry(item, item.practice.savedAt || item.paused || item.deletedAt ? 'report' : 'training');
  }

  function resumeEntry(item: DiaryEntry) {
    if (ongoing && ongoing.id !== item.id) {
      setState(previous => ({ ...previous, error: 'Сначала заверши активную тренировку.' }));
      return false;
    }
    if (!writeDiary(previous => ({ ...previous, entries: previous.entries.map(entry => entry.id === item.id ? {
      ...entry, paused: false, practice: resumePractice(entry.practice),
      personalRecords: entry.personalRecords ?? (entry.practice.savedAt !== null || entry.nativeArchiveSession ? [] : undefined),
      trainingTime: startTrainingTime(Date.now(), entry.trainingTime, true),
    } : entry) }))) return false;
    setSelection(null);
    setReportTrail([]);
    selectEntry(diaryRef.current!.entries.find(entry => entry.id === item.id)!, 'training');
    return true;
  }

  function pauseEntry() {
    if (!entry || entry.paused || completed || !saveEdit()) return;
    if (writeDiary(previous => ({ ...previous, entries: previous.entries.map(item => item.id === entry.id ? {
      ...item, paused: true,
      ...(item.trainingTime ? { trainingTime: stopTrainingTime(item.trainingTime, Date.now()) } : {}),
    } : item) }))) setPage('journal');
  }

  function openRecordReport(id: string, from: 'profile' | 'records' | 'best-ranks' | 'notebook' | 'report') {
    const item = recent.find(candidate => candidate.id === id);
    if (!item) return;
    if (from === 'report' && sessionId) setReportTrail(trail => [...trail, sessionId]);
    else if (from !== 'report') { setReportTrail([]); setReportBack(from); }
    selectEntry(item, 'report');
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
  const screenError = useKeepScreenOn(!completed && !!entry && page === 'training');
  useEffect(() => { if (!ongoing) setTimerOpen(false); }, [ongoing]);
  const editing = edit?.seriesId === series.id ? edit : null;
  const seriesEditor = page === 'editor';
  const dirty = editing !== null && JSON.stringify(editing.shot) !== JSON.stringify(series.shots[editing.index]);
  const arrowCount = series.conditions.equipment?.arrows.numberedCount ?? 0;
  const numbering = arrowCount > 0 && (practice.numberedArrows ?? true);
  const pendingShot = page === 'training' && postHit?.seriesId === series.id && series.shots[postHit.index] === postHit.shot ? postHit : null;
  useEffect(() => {
    if (!postHit) return;
    if (!pendingShot) { setPostHit(null); setPostHitReady(false); return; }
    if (!preferences.animations || preferences.hideScores || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPostHitReady(true);
      return;
    }
    // Let the score slide finish before presenting a modal above the target.
    let timeout: number | undefined;
    const frame = requestAnimationFrame(() => { timeout = window.setTimeout(() => setPostHitReady(true), 220); });
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timeout); };
  }, [postHit, pendingShot, preferences.animations, preferences.hideScores]);
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
  const roundFull = isRoundFull(practice);
  const canAppend = !seriesEditor && !!entry && !past && !completed && !(practice.roundRule.unit === 'arrows' && roundFull);
  const canInput = !pendingShot && (editing !== null || canAppend);
  const slotCount = Math.max(seriesEditor ? 1 : 3, shots.length + (canAppend ? 1 : 0));
  const seriesIds = practice.rounds.flatMap(item => item.series.map(end => end.id));
  const position = seriesIds.indexOf(series.id);
  const hasHits = practice.rounds.some(item => item.series.some(end => end.shots.length));
  const mainText = editing || seriesEditor ? 'Сохранить' : completed ? 'К статистике' : past ? 'К текущей серии'
    : roundFull ? 'Следующий раунд' : 'Следующая серия';
  const suggestRound = !seriesEditor && roundFull && !canAppend && !past && !editing && !completed;
  useEffect(() => {
    if (!suggestRound) pulse.current?.cancel();
  }, [suggestRound]);

  function mark(shot: Shot) {
    if (pendingShot) return;
    if (editing) setEdit({ ...editing, shot: { ...editing.shot, ...shot } });
    else if (canAppend && update(previous => appendShot(previous, shot))) {
      const stored = diaryRef.current?.entries.find(item => item.id === sessionId)?.practice;
      const recorded = stored && findSeries(stored, series.id)?.series.shots[shots.length] === shot;
      if (recorded && preferences.haptics) performTrainingHaptic();
      if (recorded && numbering) {
        setPostHitReady(false);
        setNumberSaveError(false);
        setPostHit({ seriesId: series.id, index: shots.length, shot });
      }
    }
  }

  function closeNumberPicker() {
    setPostHit(null);
    setPostHitReady(false);
    setNumberEditOpen(false);
    setNumberSaveError(false);
  }

  function chooseArrowNumber(value: number | undefined) {
    if (numberEditOpen && editing) {
      setEdit({ ...editing, shot: { ...editing.shot, physicalArrowNumber: value } });
      closeNumberPicker();
    } else if (pendingShot && value !== undefined) {
      if (update(previous => replaceShot(previous, pendingShot.seriesId, pendingShot.index,
        { ...pendingShot.shot, physicalArrowNumber: value }))) closeNumberPicker();
      else setNumberSaveError(true);
    }
  }

  function mainAction() {
    if (editing) saveEdit(seriesEditor);
    else if (completed) setPage('report');
    else if (past) setSelection(null);
    else if (update(advanceSeries)) setSelection(null);
  }

  function chooseShot(index: number) {
    const shot = shots[index];
    if (pendingShot || !shot) return;
    if (editing?.index === index) {
      if (seriesEditor && !dirty) setEdit(null);
      return;
    }
    if (!saveEdit()) return;
    setEdit({ seriesId: series.id, index, shot });
  }

  function undo() {
    if (editing) setEdit(seriesEditor ? { ...editing, shot: series.shots[editing.index] } : null);
    else if (!past && !completed && shots.length) update(previous => removeShot(previous, series.id, shots.length - 1));
  }

  function openPicker(kind: 'round' | 'series') {
    if (saveEdit()) setPicker(kind);
  }

  function openConfirm(kind: 'finish' | 'delete' | 'discard') {
    setConfirm(kind);
    confirmDialog.current?.showModal();
  }

  function confirmAction() {
    if (confirm === 'discard') {
      setEdit(null);
    } else if (confirm === 'delete' && editing) {
      if (update(previous => removeShot(previous, series.id, editing.index))) {
        setEdit(null);
        if (!diaryRef.current?.entries.some(item => item.id === sessionId)) setPage('journal');
        else if (seriesEditor && series.shots.length === 1) closeSeriesEditor();
      }
    } else if (confirm === 'finish' && update(previous => completePractice(previous, new Date().toISOString()))) {
      setSelection(null);
      setReportTrail([]);
      setReportBack('journal');
      setPage('report');
    }
  }

  const editorBack = useRef(() => {});
  useEffect(() => {
    editorBack.current = () => {
      if (dirty) openConfirm('discard');
      else if (editing) setEdit(null);
      else closeSeriesEditor();
    };
  });
  useEffect(() => {
    if (!seriesEditor) return;
    const key = 'fableshotSeriesEditor';
    function enter() {
      if (!window.history.state?.[key]) window.history.pushState({ ...window.history.state, [key]: true }, '');
    }
    function pop() {
      if (window.history.state?.[key]) return;
      editorBack.current();
      queueMicrotask(() => { if (document.querySelector('[data-testid="history-shot-editor"]')) enter(); });
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        editorBack.current();
      }
    }
    enter();
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('keydown', escape);
      queueMicrotask(() => {
        if (!document.querySelector('[data-testid="history-shot-editor"]') && window.history.state?.[key]) window.history.back();
      });
    };
  }, [seriesEditor]);

  function pulseNextRound() {
    if (!suggestRound || !preferences.animations || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    pulse.current?.cancel();
    pulse.current = primary.current?.animate([
      { boxShadow: 'inset 0 0 0 0 transparent' },
      { boxShadow: 'inset 0 0 0 3px var(--on-action)', offset: .14 },
      { boxShadow: 'inset 0 0 0 0 transparent' },
    ], { duration: 600, easing: 'ease-out' }) ?? null;
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
    onToggle={timer.toggle} onReset={timer.reset} onSelectPhase={timer.select} onSave={timer.save} onClose={() => setTimerOpen(false)} />;
  const notesWindow = notesScope && entry && <DiaryNotesSheet notes={entry.notes ?? []} scope={notesScope}
    includeConditionNotes={page === 'report'}
    readOnly={!!entry.deletedAt} onClose={() => setNotesScope(null)} onSave={notes => writeDiary(previous => ({
      ...previous, entries: previous.entries.map(item => item.id === entry.id ? { ...item, notes } : item),
    }))} />;
  const technique = setup ? setupMemo : practice.techniqueUses?.at(-1)?.selection ?? null;
  const techniqueWindow = techniqueOpen && <TechniqueWindow initial={memoSnapshot ?? technique} readOnly={completed || memoSnapshot !== null} onClose={() => { setTechniqueOpen(false); setMemoSnapshot(null); }}
    onPublication={publication => void recordPublication(publication)}
    onSelect={selection => {
      if (setup) { setSetupMemo(selection); setTechniqueOpen(false); return true; }
      const success = update(previous => bindTechnique(previous, selection));
      if (success) setTechniqueOpen(false);
      return success;
    }} />;
  const rankWindow = rankReference
    ? <RankReference initialBow={shownRank?.bow ?? null} initialCategory={rankCategory} onClose={() => setRankReference(false)} />
    : shownRank && <RankDetails rank={shownRank} onClose={() => setRankScope(null)}
      onOpenReference={() => setRankReference(true)}
      onCategory={category => updatePreferences({ ...preferences, rankCategory: category })} />;

  const releaseNotes = <WebReleaseNotes seen={preferencesReadable ? preferences.webReleaseSeen : null}
    onSeen={webReleaseSeen => updatePreferences({ ...preferences, webReleaseSeen })}
    showHistory={releaseHistoryOpen} onCloseHistory={() => setReleaseHistoryOpen(false)} />;
  const grants = useMemo(() => {
    if (!state.diary) return [];
    const validity = achievementValidity(state.diary);
    return (state.diary.achievementLedger?.grants ?? []).map(grant => ({ ...grant, valid: validity.get(`${grant.id}:${grant.scope}`) ?? true }));
  }, [state.diary]);
  const currentGrants = new Map(grants.map(grant => [`${grant.id}:${grant.scope}`, grant]));
  const pendingNotices = achievementQueue.map(group => groupAchievementGrants([group.leading, ...group.additional]
    .flatMap(grant => {
      const current = currentGrants.get(`${grant.id}:${grant.scope}`);
      return current && current.valid !== false ? [current] : [];
    }))[0]);
  const activeNoticeIndex = pendingNotices.findIndex(Boolean);
  const activeNotice = pendingNotices[activeNoticeIndex];
  const achievementNotice = activeNotice && preferences.showAchievementNotices !== false && !(page === 'training' && preferences.hideScores) &&
    <AchievementNotice key={`${activeNotice.leading.id}:${activeNotice.leading.scope}`} group={activeNotice}
      onShown={() => writeDiary(previous => {
        if (!previous.achievementLedger) return previous;
        const ids = new Set([activeNotice.leading, ...activeNotice.additional].map(grant => `${grant.id}:${grant.scope}`));
        if (!previous.achievementLedger.grants.some(grant => ids.has(`${grant.id}:${grant.scope}`) && !grant.notifiedAt)) return previous;
        return { ...previous, achievementLedger: { ...previous.achievementLedger, grants: previous.achievementLedger.grants.map(grant =>
          ids.has(`${grant.id}:${grant.scope}`) && !grant.notifiedAt ? { ...grant, notifiedAt: new Date().toISOString() } : grant) } };
      })}
      onNext={() => setAchievementQueue(queue => queue.slice(activeNoticeIndex + 1))} />;
  const nextRecord = recordQueue[0];
  const notice = achievementNotice || (nextRecord && preferences.showAchievementNotices !== false && !preferences.hideScores &&
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
  if (firstOnboarding || onboardingRequested || tutorialRequested) {
    function leaveOnboarding() {
      if (preferencesReadable && !preferences.onboardingSeen) updatePreferences({ ...preferences, onboardingSeen: true });
      setOnboardingDismissed(true);
      setOnboardingRequested(false);
      setTutorialRequested(false);
    }
    return <>{offlineLabel}<WebOnboarding initialExample={tutorialRequested} onClose={leaveOnboarding} onStart={() => {
      leaveOnboarding(); setSetupMemo(null); setConditionsBack('journal');
      if (ongoing) selectEntry(ongoing, 'conditions');
      else { setSessionId(null); setPage('conditions'); }
    }} onImport={() => { leaveOnboarding(); setPage('settings'); setMyTargetsOpen(true); }} /></>;
  }

  if (page === 'journal') return <JournalShell tab={tab} onTab={setTab} onSettings={() => setPage('settings')}
    displayName={preferences.displayName} onProfile={() => setPage('profile')}>
    {offlineLabel}
    {error}
    {tab === 'home' && state.diary && <JournalHome active={!!ongoing || !!paused} paused={!ongoing && !!paused} recent={recent}
      practiceCount={recent.length} arrowCount={recent.reduce((total, item) => total +
        item.practice.rounds.reduce((count, round) => count + round.series.reduce((sum, end) => sum + end.shots.length, 0), 0), 0)}
      conditions={homeConditions}
      needsEquipment={!ongoing && !paused && needsHomeEquipment} onStart={() => startPractice()} onOpen={openSaved}
      onConditions={() => {
        setSetupMemo(null);
        setConditionsBack('journal');
        if (ongoing) selectEntry(ongoing, 'conditions');
        else { setSessionId(null); setPage('conditions'); }
      }} />}
    {tab === 'history' && <JournalHistory entries={entries} filters={historyFilters} onFilters={setHistoryFilters} onOpen={openSaved} />}
    {tab === 'progress' && <JournalProgress entries={recent} />}
    {tab === 'equipment' && <EquipmentCatalog />}
    {releaseNotes}
    {notice}
  </JournalShell>;

  if (page === 'achievements') return <AchievementGallery grants={grants}
    progress={state.diary ? evaluateAchievementEvidence(eligibleForAchievements(state.diary), entry => entry.achievementEnrollment?.rankCategory ?? null) : []}
    availableRuleIds={[...ACHIEVEMENT_EVIDENCE_RULE_IDS, ...ACHIEVEMENT_ACTION_RULE_IDS, 'PROGRESS04', 'PROGRESS06', 'PROGRESS10']} onBack={() => setPage('profile')} />;
  if (page === 'records') return <>
    <PersonalRecordsScreen entries={recent} onBack={() => setPage('profile')} onOpen={id => openRecordReport(id, 'records')}
      onRanks={() => { setRanksBack('records'); setPage('best-ranks'); }} />
    {notice}
  </>;
  if (page === 'best-ranks') return <>
    <PersonalRanksScreen entries={recent} onBack={() => setPage(ranksBack)} onOpen={id => openRecordReport(id, 'best-ranks')} />
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
  if (page === 'profile') return <><ProfileScreen entries={recent} grants={grants} onAchievements={() => setPage('achievements')}
    onNotebook={() => setPage('notebook')}
    onRecords={() => setPage('records')}
    onAchievement={recordServiceAchievement} onPublication={publication => void recordPublication(publication)}
    onBack={() => setPage('journal')} onRanks={() => { setRanksBack('profile'); setPage('best-ranks'); }} />{notice}{error}</>;
  if (page === 'archive') return <><ArchiveScreen onBack={() => setPage('settings')} onAchievement={recordServiceAchievement} />{notice}{error}</>;
  if (page === 'settings' || page === 'statistics') return <SettingsScreen
    section={page === 'statistics' ? 'statistics' : settingsSection}
    onSection={section => { setSettingsSection(section); setPage('settings'); }}
    onBack={() => { setSettingsSection(null); setPage('journal'); }}
    appearance={<WebThemeSettings value={preferences} disabled={!preferencesReadable} onChange={patch => updatePreferences({ ...preferences, ...patch })} />}
    motion={<>
      <TrainingPreferenceControls keys={['animations', 'haptics']} />
      <div className="preference-row"><span className="preference-title">Показывать достижения</span>
        <button type="button" role="switch" className="preference-switch" aria-label="Показывать достижения" aria-checked={preferences.showAchievementNotices !== false}
          disabled={!preferencesReadable} onClick={() => {
            const enabled = preferences.showAchievementNotices === false;
            if (updatePreferences({ ...preferences, showAchievementNotices: enabled }) && !enabled) {
              setAchievementQueue([]);
              setRecordQueue([]);
            }
          }}><span /></button></div>
    </>}
    training={<TrainingPreferenceControls keys={['keepAwake', 'trainingOnLockScreen', 'hideScores']} />}
    statistics={<><TrainingPreferenceControls keys={['averageHundredths']} /><StatisticsSettings />
      <button type="button" className="technique-condition-link" onClick={() => setRankReference(true)}>Разрядная сетка</button></>}
    data={<>
        <button type="button" className="technique-condition-link" data-testid="settings-archive" onClick={() => setPage('archive')}>Архив и восстановление</button>
        <button type="button" className="technique-condition-link" data-testid="settings-mytargets" onClick={() => setMyTargetsOpen(true)}>Импорт MyTargets</button>
        <button type="button" className="technique-condition-link" onClick={() => setAchievementResetOpen(true)} disabled={!state.diary?.achievementLedger}>Обнулить достижения</button>
    </>}
    help={<>
      <button type="button" className="technique-condition-link" data-testid="settings-onboarding" onClick={() => setOnboardingRequested(true)}>
        <Icon name="notes" /><span>Знакомство с FableShot</span><Icon name="right" />
      </button>
      <button type="button" className="technique-condition-link" data-testid="help-tutorial" onClick={() => setTutorialRequested(true)}>
        <Icon name="help" /><span>Как отмечать попадания</span><Icon name="right" />
      </button>
    </>}
    about={<AboutScreen onReleaseNotes={() => setReleaseHistoryOpen(true)} />}>
    {offlineLabel}
    {rankWindow}
    {myTargetsOpen && <MyTargetsImport onClose={() => setMyTargetsOpen(false)} />}
    {releaseHistoryOpen && releaseNotes}
    {notice}
    {achievementResetOpen && <BottomSheet title="Обнулить достижения?" onClose={() => setAchievementResetOpen(false)}>
      <p>Тренировки останутся в истории. Достижения начнут начисляться с новых занятий.</p>
      <button type="button" className="primary" data-testid="achievement-reset-confirm" onClick={() => {
        if (writeDiary(diary => ({ ...diary, achievementLedger: { epoch: crypto.randomUUID(), grants: [] } }))) {
          setAchievementQueue([]); setAchievementResetOpen(false);
        }
      }}>Обнулить</button>
      {error}
    </BottomSheet>}
  </SettingsScreen>;

  if (page === 'conditions') return <>
    {offlineLabel}
    <ConditionsScreen initial={setup ? newConditions : active.series.conditions} rule={setup ? suggested.rule : practice.roundRule} editableRule={!hasHits}
      initialNumbering={setup ? suggested.numberedArrows : practice.numberedArrows ?? null}
      onTimer={openTimer}
      onTechnique={() => setTechniqueOpen(true)} techniqueTitle={technique?.title ?? 'Не выбрана'}
      onBack={() => { setSetupMemo(null); setPage(conditionsBack); }} onApply={(conditions, rule, numberedArrows) => {
        if (setup) {
          return startPractice(conditions, rule, numberedArrows);
        }
        const success = update(previous => {
          const next = applyConditions(previous, conditions, hasHits ? undefined : rule, numberedArrows);
          const applied = currentSeries(next)?.series.conditions;
          // The earliest pilot used a synthesized start date for an open practice.
          if (!entry || entry.id === 'pilot' || !applied || applied === currentSeries(previous)?.series.conditions) return next;
          return attachProgressBaseline(next, freezeProgressBaseline(diaryRef.current?.entries ?? [], entry.id,
            entry.startedAt, applied, new Date().toISOString()));
        }, true);
        if (success) { setSelection(null); setPage('training'); }
        return success;
      }} />
    {error}
    {timerWindow}
    {techniqueWindow}
  </>;

  if (page === 'report') return <>
    {offlineLabel}
    <ReportOverview key={sessionId} practice={practice} entries={entries} entryId={sessionId} onBack={leaveReport} onSelectSeries={openSeriesEditor}
      onPause={pauseEntry}
      onOpenRecordSession={id => openRecordReport(id, 'report')}
      onAchievement={id => recordServiceAchievement(id, sessionId ?? undefined)}
      grants={grants.filter(grant => grant.sessionId === sessionId)}
      onNotes={setNotesScope}
      onTrash={deleted => {
        if (!entry) return false;
        return writeDiary(previous => setDiaryDeleted(previous, entry.id, deleted));
      }}
      onRank={id => setRankScope({ kind: 'round', id })} onRankReference={() => setRankReference(true)}
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

  const navigation = !seriesEditor && !editing && !pendingShot && seriesIds.length > 1 && <div className="series-navigation" aria-label="Навигация по сериям">
    <button type="button" className="icon-button" aria-label="Предыдущая серия" disabled={position <= 0}
      onClick={() => showSeries(seriesIds[position - 1])}><Icon name="left" /></button>
    <button type="button" className="icon-button" aria-label="Вперёд по сериям" disabled={position >= seriesIds.length - 1}
      onClick={() => showSeries(seriesIds[position + 1])}><Icon name="right" /></button>
  </div>;
  const numberTarget = postHitReady ? pendingShot : numberEditOpen ? editing : null;

  return <main className="practice" data-testid={seriesEditor ? 'history-shot-editor' : 'training-screen'}>
    {offlineLabel}
    <header className="topbar">
      <button type="button" className="icon-button"
        aria-label={editing ? 'Удалить попадание' : seriesEditor ? 'Закрыть редактор' : completed ? 'К статистике' : hasHits ? 'Завершить тренировку' : 'На главную'}
        onClick={() => {
          if (editing) openConfirm('delete');
          else if (seriesEditor) closeSeriesEditor();
          else if (completed) setPage('report');
          else if (hasHits) openConfirm('finish');
          else if (writeDiary(previous => ({ ...previous, entries: previous.entries.filter(item => item.id !== sessionId) }))) {
            setSessionId(null);
            setPage('journal');
          }
        }}>
        <Icon name={editing ? 'delete' : completed ? 'back' : 'close'} />
      </button>
      {seriesEditor ? <div className="series-editor-heading">
        <h1>{editing ? `Стрела ${editing.index + 1}` : 'Редактор серии'}</h1>
        <span>Раунд {practice.rounds.indexOf(round) + 1} · серия {round.series.indexOf(series) + 1}</span>
      </div> : <h1>{editing ? `Стрела ${editing.index + 1}` : 'Тренировка'}</h1>}
      {seriesEditor && <button type="button" className="icon-button" aria-label="Заметки серии"
        onClick={() => { if (saveEdit(true)) setNotesScope({ seriesId: series.id }); }}><Icon name="notes" /></button>}
      {!seriesEditor && <>
      <button type="button" className="icon-button" aria-label="Памятка и фокус" data-testid="training-technique-open"
        onClick={() => { if (saveEdit()) setTechniqueOpen(true); }}><Icon name="notes" /></button>
      <button type="button" className="icon-button" aria-label="Условия тренировки" disabled={past || completed || !entry}
        onClick={() => { if (saveEdit()) { setConditionsBack('training'); setPage('conditions'); } }}><Icon name="settings" /></button>
      <button type="button" className="icon-button" aria-label="Статистика" disabled={!hasHits}
        onClick={() => { if (saveEdit()) { if (!completed) setReportBack('training'); setPage('report'); } }}><Icon name="stats" /></button>
      </>}
    </header>
    {!seriesEditor && <TrainingSummary roundNumber={practice.rounds.indexOf(round) + 1}
      seriesNumber={`${round.series.indexOf(series) + 1}${practice.roundRule.unit === 'series' ? `/${practice.roundRule.limit}` : ''}`}
      roundShots={roundShown} seriesShots={shots} onRound={() => openPicker('round')} onSeries={() => openPicker('series')}
      roundRank={currentRanks && <RankTag rank={currentRanks.round} testId="rank-round" onOpen={() => setRankScope({ kind: 'round', id: round.id })} />}
      seriesRank={currentRanks && <RankTag rank={currentRanks.series} testId="rank-series" onOpen={() => setRankScope({ kind: 'series', id: series.id })} />} />}
    <TargetBoard key={`${seriesEditor ? 'editor' : 'training'}-${series.id}-${targetSpec.profileId}-${targetSpec.diameterMm}`} shots={shots} spec={targetSpec} selectedIndex={editing?.index ?? null}
      zoomScope={seriesEditor ? 'editor' : 'training'}
      inputEnabled={canInput} panOnly={seriesEditor && !editing} onShot={mark} navigation={navigation}
      onBlockedTap={suggestRound ? pulseNextRound : undefined} />
    {error}
    <TrainingFooter shots={shots} slots={slotCount} selected={editing?.index ?? null}
      entering={!editing && canAppend ? shots.length : null} onPick={chooseShot} mainText={mainText}
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
      onNewRound={() => { if (update(startRound)) { setSelection(null); setPicker(null); } }}
      onDelete={id => {
        if (update(previous => picker === 'round' ? deleteRound(previous, id) : deleteSeries(previous, id))) {
          setPicker(null);
          if (!diaryRef.current?.entries.some(item => item.id === sessionId)) setPage('journal');
        }
      }} />}
    {timerWindow}
    {techniqueWindow}
    {rankWindow}
    {notesWindow}
    {notice}
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
withStorageOwner(() => root.render(<StrictMode><TrainingPreferencesProvider><TechniqueSettingsProvider><App /></TechniqueSettingsProvider></TrainingPreferencesProvider></StrictMode>),
  message => root.render(<main className="conditions-page"><div className="conditions-content"><h1>Дневник защищён</h1><p role="alert">{message}</p><button type="button" onClick={() => window.location.reload()}>Повторить</button></div></main>));
