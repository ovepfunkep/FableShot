import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { BottomSheet } from './ConditionsScreen.tsx';
import { exportDocument } from './document-export.ts';
import type { DiaryEntry } from './persistence.ts';
import { reportCsv, reportSnapshot } from './report-export.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './report-export.css';

export function ReportExport({ entry, onClose, onAchievement }: {
  entry: DiaryEntry; onClose: () => void;
  onAchievement?: (id: 'APP04') => void;
}) {
  const { preferences } = useTrainingPreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [preview, setPreview] = useState<string[]>([]);
  const urls = useRef<string[]>([]);
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; urls.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  async function generate(format: 'png' | 'pdf' | 'csv') {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setStatus('');
    try {
      const snapshot = reportSnapshot(entry, preferences.rankCategory ?? null, preferences.averageHundredths);
      const date = /^\d{4}-\d{2}-\d{2}/.exec(entry.startedAt)?.[0] ?? 'training';
      const name = `FableShot-${date}`;
      if (format === 'csv') {
        const saved = await exportDocument({ name: `${name}.csv`, mimeType: 'text/csv', bytes: reportCsv(entry) });
        setStatus(saved.saved ? 'CSV сохранён.' : 'Сохранение отменено.');
      } else {
        const { createReportPosters } = await import('./report-poster.ts');
        const pages = await createReportPosters(snapshot);
        if (!mounted.current) return;
        if (format === 'pdf') {
          const { createReportPdf } = await import('./report-pdf.ts');
          async function readFont(weight: string) {
            const response = await fetch(new URL(`fonts/manrope-pdf-${weight}.ttf`, document.baseURI));
            if (!response.ok) throw new Error('Не удалось загрузить шрифт PDF.');
            return new Uint8Array(await response.arrayBuffer());
          }
          const [regular, bold] = await Promise.all([readFont('regular'), readFont('bold')]);
          const saved = await exportDocument({ name: `${name}.pdf`, mimeType: 'application/pdf', bytes: await createReportPdf(pages, snapshot, { regular, bold }) });
          setStatus(saved.saved ? 'PDF сохранён.' : 'Сохранение отменено.');
        } else {
          const files = pages.map((bytes, i) => new File([new Uint8Array(bytes)], `${name}-${i + 1}.png`, { type: 'image/png' }));
          urls.current.forEach(url => URL.revokeObjectURL(url));
          urls.current = files.map(file => URL.createObjectURL(file));
          setPreview([...urls.current]); setImages(files);
          let saved = 0;
          for (const [i, file] of files.entries()) {
            const result = await exportDocument({ name: file.name, mimeType: 'image/png', bytes: pages[i],
              share: Capacitor.isNativePlatform() && files.length === 1 });
            if (!result.saved) break;
            saved++;
          }
          setStatus(Capacitor.isNativePlatform() ? `Сохранено ${saved} из ${files.length} изображений.`
            : `Передано на скачивание: ${saved}. Если браузер заблокировал файлы, сохрани их кнопками под картинками.`);
          if (files.length > 0 && saved === files.length) {
            try { onAchievement?.('APP04'); }
            catch (cause) { setError(`PNG создан. ${cause instanceof Error ? cause.message : 'Не удалось сохранить достижение.'}`); }
          }
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось подготовить отчёт.'); }
    finally { running.current = false; setBusy(false); }
  }

  const canShare = images.length > 0 && !Capacitor.isNativePlatform() && !!navigator.canShare?.({ files: images });
  async function share() {
    try { await navigator.share({ files: images, title: 'FableShot — тренировка' }); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError('Не удалось открыть отправку. Картинки доступны для скачивания.'); }
  }
  return <BottomSheet title="Поделиться…" onClose={onClose} tag="report-export">
    <div className="report-export-actions">
      <button type="button" disabled={busy} data-testid="report-export-png" onClick={() => void generate('png')}>Карточка PNG</button>
      <button type="button" disabled={busy} data-testid="report-export-pdf" onClick={() => void generate('pdf')}>Отчёт PDF</button>
      <button type="button" disabled={busy} data-testid="report-export-csv" onClick={() => void generate('csv')}>Данные CSV</button>
    </div>
    {busy && <p role="status">Готовлю отчёт…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    {canShare && <button type="button" className="report-export-share" onClick={() => void share()}>Отправить картинки</button>}
    <div className="report-export-previews">{preview.map((url, i) => <figure key={url}>
      <img src={url} alt={`Карточка тренировки, страница ${i + 1}`} />
      <figcaption><a href={url} download={images[i].name}>Скачать {i + 1}/{images.length}</a></figcaption>
    </figure>)}</div>
  </BottomSheet>;
}
