import type { ReportSnapshot } from './report-export.ts';

export type ReportFormat = 'png' | 'pdf';
export type PreparedReport = { files: File[]; previews: string[] };

/** Owned by one statistics screen. Closing its sheet keeps the immutable files. */
export function createReportShareSession(snapshot: ReportSnapshot) {
  const name = `FableShot-${/^\d{4}-\d{2}-\d{2}/.exec(snapshot.startedAt)?.[0] ?? 'training'}`;
  let posters: Promise<Uint8Array[]> | undefined;
  let disposed = false;
  const pending = new Map<ReportFormat, Promise<PreparedReport>>();
  const urls: string[] = [];
  async function images() {
    if (!posters) posters = import('./report-poster.ts').then(module => module.createReportPosters(snapshot)).catch(error => {
      posters = undefined; throw error;
    });
    return posters;
  }
  async function prepare(format: ReportFormat): Promise<PreparedReport> {
    let files: File[];
    if (format === 'png') {
      const pages = await images();
      files = pages.map((bytes, index) => new File([new Uint8Array(bytes)], `${name}-${index + 1}.png`, { type: 'image/png' }));
    } else {
      const { createReportPdf } = await import('./report-pdf.ts');
      async function font(weight: string) {
        const response = await fetch(new URL(`fonts/manrope-pdf-${weight}.ttf`, document.baseURI));
        if (!response.ok) throw new Error('Не удалось загрузить шрифт PDF.');
        return new Uint8Array(await response.arrayBuffer());
      }
      const [regular, bold] = await Promise.all([font('regular'), font('bold')]);
      const bytes = await createReportPdf(snapshot, { regular, bold });
      files = [new File([new Uint8Array(bytes)], `${name}.pdf`, { type: 'application/pdf' })];
    }
    if (disposed) throw new DOMException('Экран статистики закрыт.', 'AbortError');
    const previews = format === 'png' ? files.map(file => URL.createObjectURL(file)) : [];
    urls.push(...previews);
    return { files, previews };
  }
  return {
    name,
    get(format: ReportFormat) {
      let value = pending.get(format);
      if (!value) {
        value = prepare(format).catch(error => { pending.delete(format); throw error; });
        pending.set(format, value);
      }
      return value;
    },
    dispose() { disposed = true; urls.forEach(url => URL.revokeObjectURL(url)); pending.clear(); posters = undefined; },
  };
}
