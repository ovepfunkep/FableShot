import { Capacitor } from '@capacitor/core';
import { useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { exportDocument } from './document-export.ts';
import type { DiaryEntry } from './persistence.ts';
import { reportCsv } from './report-export.ts';
import { shareReport } from './share-report.ts';

const formats = [
  { id: 'pdf', title: 'Отчёт (PDF)' },
  { id: 'csv', title: 'Попадания (CSV)' },
  { id: 'png', title: 'Страницы (PNG)' },
] as const;

export function ProgressExport({ entries, period, onClose }: { entries: readonly DiaryEntry[]; period: string; onClose: () => void }) {
  const [format, setFormat] = useState<(typeof formats)[number]['id']>('pdf');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send(share: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const name = 'FableShot-прогресс';
      if (format === 'csv') {
        const bytes = reportCsv(entries);
        if (share && !Capacitor.isNativePlatform()) await shareReport([new File([new Uint8Array(bytes)], `${name}.csv`, { type: 'text/csv' })]);
        else await exportDocument({ name: `${name}.csv`, mimeType: 'text/csv', bytes, share });
      } else {
        const { createProgressPdf, renderProgressPages } = await import('./progress-export.ts');
        const bytes = await createProgressPdf(entries, period);
        if (format === 'pdf') {
          if (share) await shareReport([new File([new Uint8Array(bytes)], `${name}.pdf`, { type: 'application/pdf' })]);
          else await exportDocument({ name: `${name}.pdf`, mimeType: 'application/pdf', bytes });
        } else {
          const pages = await renderProgressPages(bytes);
          if (share) await shareReport(pages);
          else if (pages.length === 1) await exportDocument({ name: pages[0].name, mimeType: 'image/png', bytes: new Uint8Array(await pages[0].arrayBuffer()) });
          else {
            const { zipSync } = await import('fflate');
            const files = await Promise.all(pages.map(async page => [page.name, new Uint8Array(await page.arrayBuffer())] as const));
            await exportDocument({ name: `${name}-PNG.zip`, mimeType: 'application/zip', bytes: zipSync(Object.fromEntries(files), { level: 0 }) });
          }
        }
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось подготовить отчёт.');
    } finally { setBusy(false); }
  }
  return <BottomSheet title="Отчёт по выборке" tag="progress-export" onClose={() => { if (!busy) onClose(); }}>
    <p>Выбрано тренировок: {entries.length}. В отчёт войдут все условия этих тренировок.</p>
    <div className="report-export-actions" role="group" aria-label="Формат отчёта">
      {formats.map(item => <button type="button" key={item.id} aria-pressed={format === item.id}
        disabled={busy} onClick={() => setFormat(item.id)}>{item.title}</button>)}
    </div>
    {busy && <p role="status">Подготавливаю отчёт…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="confirm-actions">
      <button type="button" disabled={busy} onClick={() => void send(false)}>Сохранить</button>
      <button type="button" className="primary" disabled={busy} onClick={() => void send(true)}>Поделиться</button>
    </div>
  </BottomSheet>;
}
