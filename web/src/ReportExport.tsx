import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { exportDocument } from './document-export.ts';
import type { DiaryEntry } from './persistence.ts';
import { reportCsv, reportSnapshot } from './report-export.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { createReportShareSession } from './report-share-session.ts';
import type { PreparedReport, ReportFormat } from './report-share-session.ts';
import { PdfReportPreview } from './PdfReportPreview.tsx';
import { shareReport } from './share-report.ts';
import type { AchievementGrant } from './achievement-ledger.ts';
import './report-export.css';

export function ReportExport({ entry, open, onClose, onAchievement, grants }: {
  entry: DiaryEntry; open: boolean; onClose: () => void; onAchievement?: (id: 'APP04') => void;
  grants: readonly AchievementGrant[];
}) {
  const { preferences } = useTrainingPreferences();
  // Achievement notifications or opening another sheet must not invalidate files.
  const source = JSON.stringify([entry.id, entry.title, entry.startedAt, entry.practice, entry.trainingTime, entry.personalRecords,
    preferences.rankCategory, preferences.averageHundredths, preferences.disabledStatistics, preferences.showAchievementNotices]);
  const session = useMemo(() => createReportShareSession(reportSnapshot(entry, preferences.rankCategory ?? null, preferences.averageHundredths,
    { grants: preferences.showAchievementNotices === false ? [] : grants, disabledStatistics: preferences.disabledStatistics })), [source]);
  const [format, setFormat] = useState<ReportFormat>('png');
  const [prepared, setPrepared] = useState<{ session: typeof session; format: ReportFormat; value: PreparedReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pdfPage, setPdfPage] = useState(1);
  const award = useRef(onAchievement); award.current = onAchievement;
  const mounted = useRef(true);
  const currentSession = useRef(session); currentSession.current = session;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { queueMicrotask(() => {
    if (!mounted.current || currentSession.current !== session) session.dispose();
  }); }, [session]);
  useEffect(() => { setPdfPage(1); setStatus(''); }, [session]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true); setError('');
    void session.get(format).then(value => {
      if (!active) return;
      setPrepared({ session, format, value });
      if (format === 'png') award.current?.('APP04');
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Не удалось подготовить отчёт.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, format, session]);
  const ready = prepared?.session === session && prepared.format === format ? prepared.value : null;
  async function share() {
    if (!ready || sending) return;
    setSending(true); setError(''); setStatus('');
    try {
      const result = await shareReport(ready.files);
      if (mounted.current) setStatus(result === 'downloaded' ? 'Файл передан на скачивание.' : '');
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Не удалось отправить отчёт.');
    } finally { if (mounted.current) setSending(false); }
  }
  async function csv() {
    setSending(true); setError('');
    try {
      const result = await exportDocument({ name: `${session.name}.csv`, mimeType: 'text/csv', bytes: reportCsv(entry) });
      if (mounted.current) setStatus(result.saved ? 'CSV передан на сохранение.' : '');
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Не удалось сохранить CSV.');
    } finally { if (mounted.current) setSending(false); }
  }
  if (!open) return null;
  return <BottomSheet title="Поделиться…" onClose={onClose} tag="report-export">
    <div className="report-export-actions" role="group" aria-label="Вид отчёта">
      <button type="button" aria-pressed={format === 'png'} data-testid="report-export-png" onClick={() => setFormat('png')}>Красиво (PNG)</button>
      <button type="button" aria-pressed={format === 'pdf'} data-testid="report-export-pdf" onClick={() => setFormat('pdf')}>Подробно (PDF)</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="report-export-previews" aria-busy={busy}>
      {!ready && <div className={`report-export-example ${format}`} data-testid="report-export-example" aria-label="Пример оформления отчёта">
        <span>Пример оформления</span><strong>FABLESHOT</strong><small>18 м · 40 см</small>
        <b>540 / 600</b><small>Средний 9,0 · 60 стрел</small>
        <div className="report-example-hits">{[10, 9, 8, 10, 9, 10].map((score, i) => <i key={i}>{score}</i>)}</div>
        {format === 'pdf' && <div className="report-example-chart" aria-hidden="true" />}
      </div>}
      {ready && format === 'png' && ready.previews.map((url, i) => <figure key={url}>
        <img src={url} alt={`Тренировка, страница ${i + 1} из ${ready.previews.length}`} />
        {ready.previews.length > 1 && <figcaption>{i + 1} / {ready.previews.length}</figcaption>}
      </figure>)}
      {ready && format === 'pdf' && <PdfReportPreview file={ready.files[0]} page={pdfPage} onPage={setPdfPage} />}
    </div>
    {busy && <p role="status">Готовлю отчёт…</p>}
    {status && <p role="status">{status}</p>}
    <button type="button" className="report-export-share" data-testid="report-export-share" disabled={!ready || busy || sending} onClick={() => void share()}>
      {sending ? 'Открываю…' : 'Поделиться'}
    </button>
    <details className="report-export-data"><summary>Экспорт данных</summary>
      <button type="button" data-testid="report-export-csv" disabled={sending} onClick={() => void csv()}>Данные CSV</button>
    </details>
  </BottomSheet>;
}
