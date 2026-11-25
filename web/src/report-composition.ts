import type { ReportSnapshot } from './report-export.ts';
import type { ReportFormat } from './report-share-session.ts';
import { REPORT_BLOCKS } from './statistics-visibility.ts';
import type { ReportBlock, StatisticFeature } from './statistics-visibility.ts';

export type ExportSection = ReportBlock | 'focus' | 'achievements';
export type ReportComposition = { sections: readonly ExportSection[]; showShots: boolean };

const pngSections = new Set<ExportSection>(['result', 'series', 'distribution', 'norms', 'general_score']);

export function exportSectionOptions(snapshot: ReportSnapshot, format: ReportFormat, order: readonly ReportBlock[]) {
  const available: Record<ExportSection, boolean> = {
    result: true,
    series: snapshot.rounds.length > 0,
    hit_map: snapshot.analysis.some(scope => scope.shots.some(shot => shot.point || shot.missPoint)),
    distribution: true,
    norms: snapshot.rankDetails.evaluation !== null,
    mean_trend: true,
    general_score: format === 'png' ? snapshot.composite !== null : snapshot.analysis.some(scope => scope.composite?.total !== undefined),
    records: snapshot.records.length > 0,
    progress_score: snapshot.analysis.some(scope => scope.progress.length > 0),
    numbered_arrows: snapshot.numberedArrows.length > 0,
    focus: snapshot.focus.length > 0,
    achievements: snapshot.achievements.length > 0,
  };
  const labels = new Map<ExportSection, string>([...REPORT_BLOCKS, ['focus', 'Фокус тренировки'], ['achievements', 'Достижения']]);
  return [...order, 'focus', 'achievements'].filter((id): id is ExportSection => labels.has(id as ExportSection))
    .filter(id => format === 'pdf' || pngSections.has(id))
    .map(id => ({ id, label: labels.get(id)!, available: available[id] }));
}

export function defaultComposition(snapshot: ReportSnapshot, format: ReportFormat, order: readonly ReportBlock[]): ReportComposition {
  const disabled = new Set<string>(snapshot.disabledStatistics);
  return { sections: exportSectionOptions(snapshot, format, order)
    .filter(option => option.available && !disabled.has(option.id) && (format !== 'png' || option.id !== 'distribution'))
    .map(option => option.id), showShots: !disabled.has('result') };
}

export function reportSectionShown(snapshot: ReportSnapshot, composition: ReportComposition | undefined, section: ExportSection) {
  return composition ? composition.sections.includes(section) : !snapshot.disabledStatistics.includes(section as StatisticFeature);
}
