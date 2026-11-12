import { useEffect, useRef, useState } from 'react';

export function PdfReportPreview({ file, page, onPage }: { file: File; page: number; onPage: (page: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stopped = false;
    let cleanup = () => {};
    setReady(false); setError('');
    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      if (stopped) return;
      const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
      cleanup = () => { void task.destroy(); };
      if (stopped) { cleanup(); return; }
      const pdf = await task.promise;
      if (stopped) return;
      setCount(pdf.numPages);
      const selected = await pdf.getPage(Math.min(page, pdf.numPages));
      if (stopped || !canvas.current) return;
      const viewport = selected.getViewport({ scale: 1.3 });
      canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height);
      await selected.render({ canvas: canvas.current, viewport }).promise;
      if (!stopped) setReady(true);
    })().catch(cause => {
      if (!stopped) setError(cause instanceof Error ? cause.message : 'Не удалось показать страницу PDF.');
    });
    return () => { stopped = true; cleanup(); };
  }, [file, page]);
  return <div className="report-pdf-preview" data-testid="report-pdf-preview">
    <nav className="report-export-pages" aria-label="Страницы PDF">
      <button type="button" aria-label="Предыдущая страница PDF" disabled={page <= 1} onClick={() => onPage(page - 1)}>←</button>
      <span>{page} / {count || '…'}</span>
      <button type="button" aria-label="Следующая страница PDF" disabled={!count || page >= count} onClick={() => onPage(page + 1)}>→</button>
    </nav>
    {!ready && !error && <p role="status">Открываю страницу PDF…</p>}
    {error && <p role="alert">Не удалось показать PDF: {error}</p>}
    <canvas ref={canvas} hidden={!ready} aria-label={`Страница PDF ${page}`} data-testid="report-pdf-page" />
  </div>;
}
