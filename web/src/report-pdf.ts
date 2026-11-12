import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { wrapPdfText } from './technique-pdf.ts';
import type { ReportSnapshot } from './report-export.ts';
import { formatAverage } from './preferences.ts';
import { getTargetProfile, MISS_RING_WIDTH, summarize } from './target.ts';
import type { Point } from './target.ts';
import { HIT_MAP_GRID_SIZE, hitDensity, hitMapLimit, knownHitPoints, knownMissPoints } from './hit-map.ts';
import { numberedArrowMapExtent } from './numbered-arrow-analysis.ts';
import { achievementRarityFor, ACHIEVEMENT_RARITY_LABELS, getAchievementDefinition } from './achievement-catalog.ts';
import type { StatisticFeature } from './statistics-visibility.ts';

const hex = (value: string) => rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255);
const ink = hex('#17251c'), muted = hex('#667368'), accent = hex('#517631'), dark = hex('#15251a');
const paper = hex('#f5f7f1'), edge = hex('#dce4d6'), lime = hex('#c6f43d');
const zones = ['#455347', '#f6f5eb', '#f6f5eb', '#242b2e', '#242b2e', '#359ac3', '#359ac3', '#e94c40', '#e94c40', '#f6d544', '#f6d544'];
const arrowColors = ['#005a9c', '#c34700', '#007c6d', '#8c3d99', '#9a6600', '#b02d50', '#445569', '#476c00'];

/** A standalone A4 report: vector statistics and complete series, never the PNG poster. */
export async function createReportPdf(snapshot: ReportSnapshot, fonts: { regular: Uint8Array; bold: Uint8Array }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('FableShot — тренировка'); pdf.setAuthor('FableShot'); pdf.setSubject('Подробная статистика тренировки');
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const left = 42, width = 511, bottom = 52;
  let page!: PDFPage, y = 0, section = '';
  const shown = (feature: StatisticFeature) => !snapshot.disabledStatistics.includes(feature);
  const decimal = (value: number | null | undefined, precise = snapshot.hundredths) => value == null ? '—' : formatAverage(value, precise);
  function text(value: string, x: number, top: number, size = 10, heavy = false, color = ink) {
    const printable = Array.from(value, char => supported.has(char.codePointAt(0)!) ? char : '□').join('');
    page.drawText(printable, { x, y: top - size, size, font: heavy ? bold : font, color });
  }
  function lines(value: string, maxWidth: number, size = 10, heavy = false) {
    return value.split(/\r?\n/).flatMap(line => line ? wrapPdfText(line, maxWidth, part => (heavy ? bold : font).widthOfTextAtSize(part, size)) : ['']);
  }
  function box(x: number, top: number, w: number, h: number, fill = rgb(1, 1, 1)) {
    const r = 10;
    page.drawSvgPath(`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`,
      { x, y: top, color: fill, borderColor: edge, borderWidth: .6 });
  }
  function newPage(title: string) {
    section = title; page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: paper });
    page.drawRectangle({ x: 0, y: 774, width: 595, height: 68, color: dark });
    for (const radius of [30, 52, 77]) page.drawCircle({ x: 560, y: 834, size: radius, borderColor: lime, borderWidth: .8, borderOpacity: .12 });
    text('FABLESHOT', left, 819, 16, true, lime);
    text(title, 205, 814, 10, false, rgb(.9, .94, .88));
    y = 752;
  }
  function ensure(height: number) { if (y - height < bottom) newPage(section); }
  function heading(title: string, keep = 100) {
    const wrapped = lines(title, width, 16, true);
    ensure(Math.max(keep, wrapped.length * 23 + 45));
    for (const line of wrapped) { text(line, left, y, 16, true); y -= 23; }
    y -= 8;
  }
  function paragraph(value: string, size = 10, color = muted) {
    for (const line of lines(value, width, size)) { ensure(size + 7); text(line, left, y, size, false, color); y -= size + 6; }
    y -= 5;
  }
  function metrics(values: { label: string; value: string }[]) {
    if (!values.length) return;
    const columns = Math.min(values.length, 3), gap = 10, w = (width - gap * (columns - 1)) / columns;
    for (let start = 0; start < values.length; start += columns) {
      ensure(84);
      values.slice(start, start + columns).forEach((metric, index) => {
        const x = left + index * (w + gap);
        box(x, y, w, 68); text(metric.label, x + 13, y - 10, 8, false, muted);
        let size = 21;
        while (bold.widthOfTextAtSize(metric.value, size) > w - 26 && size > 10) size--;
        text(metric.value, x + 13, y - 29, size, true);
      }); y -= 82;
    }
  }
  function trend(values: { label: string; value: number }[], title: string) {
    for (let start = 0; start < values.length; start += 24) {
      const samples = values.slice(start, start + 24);
      ensure(225); text(`${title}${values.length > 24 ? ` · ${start + 1}–${start + samples.length}` : ''}`, left, y, 12, true); y -= 24;
      box(left, y, width, 172);
      const x0 = left + 29, x1 = left + width - 18, top = y - 20, base = y - 139;
      for (const value of [0, 5, 10]) {
        const at = base + value * (top - base) / 10;
        page.drawLine({ start: { x: x0, y: at }, end: { x: x1, y: at }, color: edge, thickness: .6 });
        text(String(value), left + 9, at + 4, 7, false, muted);
      }
      const points = samples.map((sample, index) => ({ x: samples.length === 1 ? (x0 + x1) / 2 : x0 + index * (x1 - x0) / (samples.length - 1), y: base + sample.value * (top - base) / 10 }));
      points.forEach((point, index) => {
        if (index) page.drawLine({ start: points[index - 1], end: point, color: accent, thickness: 1.6 });
        page.drawCircle({ ...point, size: 2.4, color: accent });
        const label = decimal(samples[index].value);
        text(label, point.x - font.widthOfTextAtSize(label, 7) / 2, point.y + 14, 7, true, accent);
        if (samples.length <= 12 || index % 3 === 0 || index === samples.length - 1) text(samples[index].label, point.x - 8, base - 10, 7, false, muted);
      }); y -= 190;
    }
  }
  function target(conditions: ReportSnapshot['analysis'][number]['conditions'], center: Point, radius: number, extent: number, showMissRing = false) {
    const profile = getTargetProfile(conditions.targetProfileId);
    if (profile && showMissRing) page.drawCircle({ x: center.x, y: center.y,
      size: radius * (profile.zones.at(-1)!.outerRadius + MISS_RING_WIDTH) / extent, color: hex('#536052') });
    for (const zone of [...profile?.zones ?? []].reverse()) page.drawCircle({ x: center.x, y: center.y, size: radius * zone.outerRadius / extent,
      color: hex(zones[zone.points]), borderColor: muted, borderWidth: .3 });
  }
  function dot(point: Point, center: Point, radius: number, extent: number, color = ink) {
    page.drawCircle({ x: center.x + point.x * radius / extent, y: center.y - point.y * radius / extent, size: 2.1,
      color, borderColor: rgb(1, 1, 1), borderWidth: .6 });
  }

  newPage('ПОДРОБНЫЙ ОТЧЁТ');
  paragraph(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(snapshot.startedAt)), 10);
  heading(snapshot.title);
  if (shown('training_time') && snapshot.duration) paragraph(snapshot.duration, 11, accent);
  snapshot.conditions.forEach((condition, i) => paragraph(`${snapshot.conditions.length > 1 ? `${i + 1}. ` : ''}${condition}`, 10));
  metrics([
    ...(shown('result') ? [{ label: 'РЕЗУЛЬТАТ', value: `${snapshot.result.points} / ${snapshot.result.maximum}` }] : []),
    ...(shown('average') ? [{ label: 'СРЕДНИЙ БАЛЛ', value: snapshot.average }] : []),
    ...(shown('volume') ? [{ label: 'СТРЕЛ', value: String(snapshot.result.maximum / 10) }] : []),
  ]);
  if (snapshot.focus.length) { heading('Фокус тренировки'); snapshot.focus.forEach(focus => paragraph(focus)); }
  if (shown('norms')) {
    heading('Нормативы', 200);
    const rank = snapshot.rankDetails, evaluation = rank.evaluation;
    if (!evaluation) paragraph(rank.reason ?? 'Нет данных для сравнения.');
    else {
      ensure(155); box(left, y, width, 136);
      text(`${rank.finalResult ? 'По очкам' : 'Темп'} · ${rank.label}`, left + 15, y - 12, 19, true, accent);
      text(`${rank.classLabel} · ${evaluation.entered} из ${evaluation.exercise.arrows} стрел · средний ${decimal(evaluation.average)}`, left + 15, y - 42, 9, false, muted);
      const lineY = y - 82, start = left + 20, length = width - 40;
      page.drawLine({ start: { x: start, y: lineY }, end: { x: start + length, y: lineY }, color: edge, thickness: 4 });
      evaluation.exercise.thresholds.forEach(threshold => {
        const x = start + threshold.score / evaluation.exercise.arrows / 10 * length;
        page.drawLine({ start: { x, y: lineY - 7 }, end: { x, y: lineY + 7 }, color: muted, thickness: 1 });
      });
      page.drawCircle({ x: start + Math.max(0, Math.min(10, evaluation.average ?? 0)) / 10 * length, y: lineY, size: 5, color: accent });
      text('0', start, lineY - 10, 7, false, muted); text('10', start + length - 8, lineY - 10, 7, false, muted);
      const next = evaluation.next;
      text(next ? `Следующий: ${next.label} · от ${decimal(next.score / evaluation.exercise.arrows, true)} за стрелу` : 'Высший доступный уровень по этой сетке', left + 15, y - 111, 9, true, accent);
      y -= 151;
      paragraph(rank.finalResult ? 'Сравнение по очкам упражнения; официальное присвоение разряда требует выполнения условий ЕВСК.'
        : 'Это прогноз по текущему среднему. Полное упражнение ещё не подтверждено.', 8);
      const thresholds = evaluation.exercise.thresholds.map(item => `${item.label}: ${decimal(item.score / evaluation.exercise.arrows, true)} / ${item.score}`);
      paragraph(thresholds.join('    ·    '), 8);
    }
  }
  if (shown('mean_trend')) trend(snapshot.rounds.flatMap(round => round.series.map(series => ({ label: `${round.number}.${series.number}`, value: summarize(series.shots).average ?? 0 }))), 'Средний балл по сериям');

  if (shown('records') && snapshot.records.length) {
    heading('Личные рекорды');
    snapshot.records.forEach(record => { ensure(45); text(record.label, left, y, 11, true); y -= 19; paragraph(`${record.previousValue} → ${record.value}`, 11, accent); });
  }
  if (snapshot.achievements.length) {
    heading('Достижения тренировки');
    for (const group of snapshot.achievements) {
      const rule = getAchievementDefinition(group.leading.id);
      if (!rule) continue;
      ensure(70); text(rule.title, left, y, 12, true, accent); y -= 21;
      paragraph(`${ACHIEVEMENT_RARITY_LABELS[achievementRarityFor(rule, group.leading.scope)]} · ${rule.flavor}`, 9);
      if (group.additional.length) paragraph(`Ещё в группе: ${group.additional.map(grant => getAchievementDefinition(grant.id)?.title ?? grant.id).join(', ')}`, 8);
    }
  }

  if (shown('series')) {
    ensure(160);
    for (const round of snapshot.rounds) {
      const firstCard = 37 + Math.ceil(Math.min(round.series[0].shots.length, 90) / 18) * 27;
      heading(`Раунд ${round.number}`, firstCard + 75);
      const summary = [shown('result') && `${round.result.points}/${round.result.maximum}`,
        shown('average') && `средний ${decimal(round.result.average)}`,
        shown('volume') && `${round.result.maximum / 10} стрел`,
        shown('norms') && round.rank.label && `${round.rank.finalResult ? 'По очкам' : 'Темп'} · ${round.rank.label}`].filter(Boolean).join(' · ');
      if (summary) paragraph(summary, 11, accent);
      for (const series of round.series) for (let start = 0; start < series.shots.length; start += 90) {
        const shots = series.shots.slice(start, start + 90), result = summarize(series.shots);
        const height = shown('result') ? 37 + Math.ceil(shots.length / 18) * 27 : 31;
        ensure(height + 12); box(left, y, width, height);
        text(`Р${round.number} · Серия ${series.number}${start ? ' · продолжение' : ''}`, left + 12, y - 9, 9, true);
        const totals = [shown('result') && `${result.points}/${result.maximum}`, shown('average') && `средний ${decimal(result.average)}`,
          shown('volume') && `${series.shots.length} стрел`].filter(Boolean).join(' · ');
        text(totals, left + width - 12 - font.widthOfTextAtSize(totals, 8), y - 10, 8, false, muted);
        if (shown('result')) shots.forEach((shot, i) => {
          const x = left + 12 + (i % 18) * 27, top = y - 30 - Math.floor(i / 18) * 27;
          page.drawRectangle({ x, y: top - 22, width: 22, height: 22, color: hex(zones[shot.points]) });
          text(shot.code, x + (22 - bold.widthOfTextAtSize(shot.code, 9)) / 2, top - 5, 9, true, shot.points === 0 || shot.points === 3 || shot.points === 4 ? rgb(1, 1, 1) : ink);
        }); y -= height + 10;
      }
      y -= 8;
    }
  }

  for (const [index, scope] of snapshot.analysis.entries()) {
    newPage(`АНАЛИТИКА · УСЛОВИЯ ${index + 1}`);
    paragraph(snapshot.conditions[index], 10);
    heading('Результат и точность');
    metrics([
      ...(shown('result') ? [{ label: 'ОЧКИ', value: `${scope.result.points}/${scope.result.maximum}` }] : []),
      ...(shown('average') ? [{ label: 'СРЕДНИЙ', value: decimal(scope.result.average) }] : []),
      ...(shown('grouping') ? [{ label: 'КУЧНОСТЬ RMS', value: `${decimal(scope.geometry?.rmsMm)} мм` }] : []),
      ...(shown('offset') && scope.geometry ? [{ label: 'СМЕЩЕНИЕ ОТ ЦЕНТРА', value: `${decimal(scope.geometry.shiftMm)} мм` }] : []),
      ...(shown('zone_trend') ? [{ label: 'ДОЛЯ ДЕСЯТОК', value: `${decimal(scope.distribution[10] / scope.shots.length * 100)}%` }] : []),
      ...(shown('volume') ? [{ label: 'СТРЕЛ', value: String(scope.shots.length) }] : []),
    ]);
    const composite = scope.composite;
    if (shown('general_score') && composite?.total !== undefined) {
      heading('Общие очки');
      metrics([{ label: 'CG3', value: `${decimal(composite.total, true)} / 105` }]);
      const components = [
        { label: 'За попадания', value: composite.base, max: 100 },
        ...(shown('grouping') ? [{ label: 'За кучность', value: composite.groupBonus, max: 4 }] : []),
        ...(shown('stability') ? [{ label: 'За стабильность', value: composite.stabilityBonus, max: 1 }] : []),
      ];
      ensure(components.length * 37 + 20);
      for (const component of components) {
        text(component.label, left, y, 10); text(`${decimal(component.value, true)} / ${component.max}`, left + 403, y, 10, true, accent);
        page.drawRectangle({ x: left, y: y - 23, width, height: 4, color: edge });
        if (component.value !== undefined) page.drawRectangle({ x: left, y: y - 23, width: width * Math.max(0, Math.min(1, component.value / component.max)), height: 4, color: accent });
        y -= 37;
      } y -= 10;
    }
    if (shown('progress_score') && scope.progress.length) {
      heading('Прогресс в этих условиях');
      scope.progress.forEach(progress => {
        const value = progress.relativePercent == null ? `${decimal(progress.rawIncrease, true)} балла`
          : `${progress.relativePercent >= 0 ? '+' : ''}${decimal(progress.relativePercent, true)}%`;
        paragraph(`${value}${progress.fullRankAvailable ? '' : ' · предварительно'} · средний ${decimal(progress.baselineAverage)} → ${decimal(progress.currentAverage)}`, 12, accent);
      });
    }
    if (shown('hit_map')) {
      ensure(295); heading('Карта попаданий');
      const points = knownHitPoints(scope.shots), misses = knownMissPoints(scope.shots);
      const extent = hitMapLimit([...points, ...misses]), radius = 95;
      const centers = [{ x: left + 124, y: y - 117 }, { x: left + 387, y: y - 117 }];
      text('Попадания', left + 88, y, 10, true); text('Плотность', left + 355, y, 10, true);
      centers.forEach(center => target(scope.conditions, center, radius, extent, !!misses.length));
      points.forEach(point => dot(point, centers[0], radius, extent));
      const density = hitDensity(points, extent), cell = radius * 2 / HIT_MAP_GRID_SIZE;
      for (const value of density.cells) {
        const level = Math.min(3, Math.ceil(value.count / density.peak * 4) - 1);
        page.drawRectangle({ x: centers[1].x - radius + value.column * cell, y: centers[1].y + radius - (value.row + 1) * cell,
          width: cell, height: cell, color: hex(['#c3d987', '#9fbe64', '#689548', '#315c34'][level]), opacity: .6 });
      }
      for (const center of centers) for (const point of misses) {
        const x = center.x + point.x * radius / extent;
        const y = center.y - point.y * radius / extent;
        for (const direction of [-1, 1]) page.drawLine({ start: { x: x - 2.4, y: y - direction * 2.4 },
          end: { x: x + 2.4, y: y + direction * 2.4 }, color: rgb(1, 1, 1), thickness: 1.3 });
      }
      if (misses.length) text('×  Промах с координатами', left + 25, y - 227, 8, false, muted);
      text('Редко', left + 304, y - 227, 8, false, muted); text('Часто', left + 444, y - 227, 8, false, muted);
      for (let step = 0; step < 4; step++) page.drawRectangle({ x: left + 341 + step * 23, y: y - 234, width: 21, height: 8, color: hex(['#c3d987', '#9fbe64', '#689548', '#315c34'][step]), opacity: .7 });
      y -= 259;
    }
    if (shown('distribution')) {
      ensure(190); heading('Распределение попаданий');
      const peak = Math.max(...scope.distribution, 1), base = y - 116;
      scope.distribution.forEach((count, zone) => {
        const x = left + 10 + zone * 45, height = count / peak * 93;
        page.drawRectangle({ x, y: base, width: 30, height: Math.max(height, .7), color: accent, opacity: count ? 1 : .2 });
        text(String(count), x + 10, base + height + 14, 8, true, accent);
        text(zone === 0 ? 'M' : String(zone), x + 10, base - 7, 8, false, muted);
      }); y -= 152;
    }
  }

  if (shown('numbered_arrows')) for (const group of snapshot.numberedArrows) {
    newPage('ПО НОМЕРАМ СТРЕЛ'); paragraph(group.label, 10); heading('Сравнение попаданий');
    ensure(300);
    const center = { x: 297, y: y - 118 }, radius = 110, extent = numberedArrowMapExtent(group, shown('grouping'));
    target(group.conditions, center, radius, extent);
    group.arrows.forEach((arrow, i) => {
      const color = hex(arrowColors[i % arrowColors.length]);
      if (shown('grouping') && arrow.centroid && arrow.rmsMm !== null) page.drawCircle({
        x: center.x + arrow.centroid.x * radius / extent, y: center.y - arrow.centroid.y * radius / extent,
        size: arrow.rmsMm / (group.conditions.targetDiameterMm / 2) * radius / extent, color, opacity: .16, borderColor: color, borderWidth: .8,
      });
      arrow.points.forEach(point => dot(point, center, radius, extent, color));
    }); y -= 262;
    ensure(36); text('Стрела', left + 15, y, 9, true); text('Выстрелы', 165, y, 9, true); text('Средний', 262, y, 9, true); text('RMS, мм', 360, y, 9, true); text('Смещение, мм', 440, y, 9, true); y -= 23;
    group.arrows.forEach((arrow, i) => {
      ensure(31); box(left, y, width, 26);
      page.drawCircle({ x: left + 13, y: y - 13, size: 3, color: hex(arrowColors[i % arrowColors.length]) });
      text(`№ ${arrow.number}`, left + 24, y - 6, 9, true);
      text(shown('volume') ? String(arrow.shotCount) : '—', 181, y - 6, 9);
      text(shown('average') ? decimal(arrow.average) : '—', 274, y - 6, 9);
      text(shown('grouping') ? decimal(arrow.rmsMm) : '—', 365, y - 6, 9);
      text(shown('offset') ? decimal(arrow.shiftMm) : '—', 458, y - 6, 9); y -= 31;
    });
  }
  for (const [index, sheet] of pdf.getPages().entries()) {
    page = sheet;
    page.drawLine({ start: { x: left, y: 35 }, end: { x: left + width, y: 35 }, color: edge, thickness: .5 });
    text('Каждая стрела — часть истории.', left, 26, 7, false, muted);
    text(`${index + 1} / ${pdf.getPageCount()}`, 518, 26, 7, false, muted);
  }
  return pdf.save();
}
