import type { Conditions } from './conditions.ts';
import { findSeries } from './practice.ts';
import type { Practice, Round, Series } from './practice.ts';
import { summarize } from './target.ts';

export const RANK_REVISION = 'ru-evsk-201-2026-app34-v1';
export const RANK_SOURCE = 'https://minsport.gov.ru/evsk-2026-2029-strelba-iz-luka/';
export const RANK_DOCUMENT = 'https://storage.minsport.gov.ru/cms-uploads/cms/Strelba_iz_luka_b944ba5e4d.xls';
export const RANK_LABELS = ['МСМК', 'МС', 'КМС', 'I', 'II', 'III', 'I юн.', 'II юн.', 'III юн.'] as const;
export const RANK_CATEGORIES = { male: 'Мужчины', female: 'Женщины' } as const;
const bowClasses = { recurve: 'КЛ', barebow: 'КЛб', compound: 'БЛ' } as const;

export type RankCategory = keyof typeof RANK_CATEGORIES;
export type RankBow = keyof typeof bowClasses;
export type RankGroup = RankBow | '3d';
export type RankThreshold = { label: typeof RANK_LABELS[number]; score: number };
export type RankReferenceRow = {
  sourceRow: number;
  group: RankGroup;
  title: string;
  volume: string;
  condition: string;
  male: readonly (number | null)[];
  female: readonly (number | null)[];
};

// Numeric rows from Android SportRankReference, pinned to the same revision of the Ministry workbook.
export const RANK_REFERENCE: readonly RankReferenceRow[] = [
  { sourceRow: 9, group: "recurve", title: "КЛ - 12 м (30+30 выстрелов)", volume: "30 выстрелов", condition: "", male: [null, null, null, null, null, null, 220, 210, 200], female: [null, null, null, null, null, null, 210, 205, 200] },
  { sourceRow: 10, group: "recurve", title: "КЛ - 12 м (30+30 выстрелов)", volume: "60 выстрелов", condition: "", male: [null, null, null, null, null, null, 420, 410, 400], female: [null, null, null, null, null, null, 410, 405, 400] },
  { sourceRow: 11, group: "recurve", title: "КЛ - 18 м (30+30 выстрелов) + финал", volume: "30 выстрелов", condition: "", male: [null, null, null, 260, 240, 215, 195, 175, 155], female: [null, null, null, 250, 235, 210, 190, 170, 150] },
  { sourceRow: 12, group: "recurve", title: "КЛ - 18 м (30+30 выстрелов) + финал", volume: "60 выстрелов", condition: "", male: [586, 570, 530, 500, 455, 415, 375, 335, 295], female: [582, 566, 525, 490, 450, 410, 370, 330, 290] },
  { sourceRow: 13, group: "recurve", title: "КЛ - 50 м, 30 м (72 выстрелов)", volume: "", condition: "", male: [null, null, null, 550, 530, 480, 430, 400, 370], female: [null, null, null, 540, 520, 470, 420, 390, 360] },
  { sourceRow: 14, group: "recurve", title: "КЛ - 60 м (36+36 выстрелов) + финал", volume: "", condition: "Условие: только для юношей и девушек (14-17 лет)", male: [null, null, 625, 595, 545, 510, null, null, null], female: [null, null, 605, 580, 525, 490, null, null, null] },
  { sourceRow: 16, group: "recurve", title: "КЛ - 60 м, 50 м, 40 м, 30 м (144 выстрелов) + 60 м финал", volume: "", condition: "Условие: только для девушек (14-17 лет)", male: [null, null, null, null, null, null, null, null, null], female: [null, null, 1230, 1170, 1100, 1050, 1000, 950, 900] },
  { sourceRow: 18, group: "recurve", title: "КЛ - 70 м (36 + 36 выстрелов) + финал", volume: "", condition: "", male: [670, 640, 615, 580, 530, 500, null, null, null], female: [664, 630, 600, 560, 510, 480, null, null, null] },
  { sourceRow: 19, group: "recurve", title: "КЛ - 70 м (72 выстрелов)", volume: "", condition: "", male: [null, null, null, null, null, null, null, null, null], female: [null, 630, 600, 560, 510, 480, null, null, null] },
  { sourceRow: 20, group: "recurve", title: "КЛ - 70 м, 60 м, 50 м, 30 м (144 выстрелов) + 60 м финал", volume: "", condition: "Условие: только для юношей (14-17 лет)", male: [null, null, 1220, 1155, 1090, 1040, 990, 940, 890], female: [null, null, null, null, null, null, null, null, null] },
  { sourceRow: 22, group: "recurve", title: "КЛ - 70 м, 60 м, 50 м, 30 м (144 выстрелов) + 70 м финал", volume: "", condition: "", male: [null, null, null, null, null, null, null, null, null], female: [1320, 1250, 1180, 1120, 980, 900, null, null, null] },
  { sourceRow: 23, group: "recurve", title: "КЛ - 90 м (72 выстрелов)", volume: "", condition: "", male: [null, 580, 540, 500, 460, 420, null, null, null], female: [null, null, null, null, null, null, null, null, null] },
  { sourceRow: 24, group: "recurve", title: "КЛ - 90 м, 70 м, 50 м, 30 м (144 выстрелов) + 70 м финал", volume: "", condition: "", male: [1320, 1250, 1180, 1120, 980, 900, null, null, null], female: [null, null, null, null, null, null, null, null, null] },
  { sourceRow: 25, group: "barebow", title: "КЛ - бесприцельный - 18 м (30+30 выстрелов) + финал", volume: "30 выстрелов", condition: "", male: [null, null, null, 243, 225, 206, null, null, null], female: [null, null, null, 240, 222, 203, null, null, null] },
  { sourceRow: 26, group: "barebow", title: "КЛ - бесприцельный - 18 м (30+30 выстрелов) + финал", volume: "60 выстрелов", condition: "", male: [553, 538, 502, 467, 429, 392, null, null, null], female: [549, 534, 497, 462, 425, 387, null, null, null] },
  { sourceRow: 27, group: "compound", title: "БЛ - 12 м (30+30 выстрелов)", volume: "30 выстрелов", condition: "", male: [null, null, null, null, null, null, 230, 225, 220], female: [null, null, null, null, null, null, 220, 215, 210] },
  { sourceRow: 28, group: "compound", title: "БЛ - 12 м (30+30 выстрелов)", volume: "60 выстрелов", condition: "", male: [null, null, null, null, null, null, 440, 430, 420], female: [null, null, null, null, null, null, 430, 420, 410] },
  { sourceRow: 29, group: "compound", title: "БЛ - 18 м (30+30 выстрелов) + финал", volume: "30 выстрелов", condition: "", male: [null, null, null, 260, 240, 215, 195, 175, 155], female: [null, null, null, 250, 235, 210, 190, 170, 150] },
  { sourceRow: 30, group: "compound", title: "БЛ - 18 м (30+30 выстрелов) + финал", volume: "60 выстрелов", condition: "", male: [586, 570, 530, 500, 455, 415, 375, 335, 295], female: [582, 566, 525, 490, 450, 410, 370, 330, 290] },
  { sourceRow: 31, group: "compound", title: "БЛ - 50 м (36+36 выстрелов) + финал", volume: "", condition: "", male: [700, 680, 660, 640, 620, 600, null, null, null], female: [690, 670, 650, 630, 610, 590, null, null, null] },
  { sourceRow: 32, group: "compound", title: "БЛ - 50 м, 30 м (72 выстрелов)", volume: "", condition: "", male: [null, null, null, 575, 550, 500, 450, 420, 390], female: [null, null, null, 565, 540, 490, 440, 410, 380] },
  { sourceRow: 33, group: "compound", title: "БЛ - 60 м (36 + 36 выстрелов) + финал", volume: "", condition: "Условие: только для юношей и девушек (14-17 лет)", male: [null, null, 650, 620, 570, 530, null, null, null], female: [null, null, 640, 610, 560, 510, null, null, null] },
  { sourceRow: 35, group: "compound", title: "БЛ - 60 м, 50 м, 40 м, 30 м (144 выстрелов) + 60 м финал", volume: "", condition: "Условие: только для девушек (14-17 лет)", male: [null, null, null, null, null, null, null, null, null], female: [null, null, 1280, 1220, 1160, 1100, 1050, 1000, 950] },
  { sourceRow: 37, group: "compound", title: "БЛ - 70 м (36+36 выстрелов) + финал", volume: "", condition: "", male: [685, 660, 640, 610, 555, 525, null, null, null], female: [675, 655, 620, 585, 535, 505, null, null, null] },
  { sourceRow: 38, group: "compound", title: "БЛ - 70 м (72 выстрелов)", volume: "", condition: "", male: [null, null, null, null, null, null, null, null, null], female: [null, 655, 620, 585, 535, 505, null, null, null] },
  { sourceRow: 39, group: "compound", title: "БЛ - 70 м, 60 м, 50 м, 30 м (144 выстрелов) + 60м финал", volume: "", condition: "Условие: только для юношей (14-17 лет)", male: [null, null, 1280, 1210, 1080, 1000, 920, 850, 800], female: [null, null, null, null, null, null, null, null, null] },
  { sourceRow: 41, group: "compound", title: "БЛ - 70 м, 60 м, 50 м, 30 м (144 выстрелов) + 70 м финал", volume: "", condition: "", male: [null, null, null, null, null, null, null, null, null], female: [1380, 1300, 1230, 1140, 1020, 950, null, null, null] },
  { sourceRow: 42, group: "compound", title: "БЛ - 90 м (72 выстрелов)", volume: "", condition: "", male: [null, 640, 600, 530, 500, 450, null, null, null], female: [null, null, null, null, null, null, null, null, null] },
  { sourceRow: 43, group: "compound", title: "БЛ - 90 м, 70 м, 50 м, 30 м (144 выстрелов) + 70 м финал", volume: "", condition: "", male: [1370, 1300, 1230, 1160, 1020, 950, null, null, null], female: [null, null, null, null, null, null, null, null, null] },
  { sourceRow: 44, group: "3d", title: "3Д - БЛ - 5-45 м (квалификация + финал)", volume: "96 выстрелов", condition: "", male: [980, 950, 900, 840, 780, 720, null, null, null], female: [920, 880, 820, 750, 680, 610, null, null, null] },
  { sourceRow: 45, group: "3d", title: "3Д - КЛ - 3-30 м (квалификация + финал)", volume: "96 выстрелов", condition: "", male: [880, 830, 770, 700, 630, 560, null, null, null], female: [820, 770, 720, 660, 590, 520, null, null, null] },
  { sourceRow: 46, group: "3d", title: "3Д - составной лук - 3-30 м (квалификация + финал)", volume: "96 выстрелов", condition: "", male: [810, 760, 710, 650, 590, 520, null, null, null], female: [710, 660, 610, 550, 490, 420, null, null, null] },
  { sourceRow: 47, group: "3d", title: "3Д - длинный лук - 3-30 м (квалификация + финал)", volume: "96 выстрелов", condition: "", male: [740, 690, 630, 570, 510, 450, null, null, null], female: [640, 590, 530, 470, 410, 350, null, null, null] },
];

export type RankExercise = {
  id: string;
  bow: RankBow;
  distance: number;
  arrows: number;
  category: RankCategory;
  sourceRow: number;
  thresholds: readonly RankThreshold[];
};

// Only the target/discipline combinations supported by Android RankMatching are eligible.
const supportedFormats = [
  { sourceRow: 11, bow: 'recurve', distance: 18, arrows: 30, diameter: 400, targets: ['wa-indoor-outer-v1'] },
  { sourceRow: 12, bow: 'recurve', distance: 18, arrows: 60, diameter: 400, targets: ['wa-indoor-outer-v1'] },
  { sourceRow: 25, bow: 'barebow', distance: 18, arrows: 30, diameter: 400, targets: ['wa-indoor-outer-v1'] },
  { sourceRow: 26, bow: 'barebow', distance: 18, arrows: 60, diameter: 400, targets: ['wa-indoor-outer-v1'] },
  { sourceRow: 29, bow: 'compound', distance: 18, arrows: 30, diameter: 400, targets: ['wa-indoor-inner-v1'] },
  { sourceRow: 30, bow: 'compound', distance: 18, arrows: 60, diameter: 400, targets: ['wa-indoor-inner-v1'] },
  { sourceRow: 18, bow: 'recurve', distance: 70, arrows: 72, diameter: 1220, targets: ['wa-outdoor-full-v1'] },
  { sourceRow: 31, bow: 'compound', distance: 50, arrows: 72, diameter: 800, targets: ['wa-outdoor-full-v1', 'wa-outdoor-six-v1'] },
] satisfies { sourceRow: number; bow: RankBow; distance: number; arrows: number; diameter: number; targets: string[] }[];

const referenceRowsById = new Map(RANK_REFERENCE.map(row => [row.sourceRow, row]));

export const STAGE_RANK_LABELS = ['III', 'II', 'I', 'КМС', 'МС', 'МСМК'] as const;
export const STAGE_RANK_FORMATS = supportedFormats.flatMap(format =>
  (['male', 'female'] as const).flatMap(category => format.targets.map(target => ({
    scope: `stage-v1:${format.bow}-${format.distance}-${format.arrows}-${category}:${target}`,
    bow: format.bow, distance: format.distance, arrows: format.arrows, diameter: format.diameter, category, target,
    thresholds: referenceRowsById.get(format.sourceRow)![category],
  }))));

export function matchingRankExercises(conditions: Conditions, category: RankCategory): RankExercise[] {
  return supportedFormats.filter(format => format.bow === conditions.equipment?.bow.category &&
    format.distance === conditions.distanceMeters && format.diameter === conditions.targetDiameterMm &&
    format.targets.includes(conditions.targetProfileId)).map(({ sourceRow, bow, distance, arrows }) => {
    const scores = referenceRowsById.get(sourceRow)![category];
    const thresholds = scores.flatMap((score, index) => score === null ? [] : [{ label: RANK_LABELS[index], score }]).reverse();
    return { id: `${bow}-${distance}-${arrows}-${category}`, bow, distance, arrows, category, sourceRow, thresholds };
  });
}

export type RankEvaluation = {
  exercise: RankExercise;
  points: number;
  entered: number;
  average: number | null;
  projected: number | null;
  pace: RankThreshold | null;
  next: RankThreshold | null;
  complete: boolean;
  result: RankThreshold | null;
  remainingAverage: number | null;
};

export function evaluateRank(exercise: RankExercise, points: number, entered: number): RankEvaluation {
  const average = entered === 0 ? null : points / entered;
  const projected = average === null ? null : average * exercise.arrows;
  const complete = entered === exercise.arrows;
  // Integer comparisons keep rounded display values from promoting a result.
  const reaches = (threshold: RankThreshold) => entered > 0 && points * exercise.arrows >= threshold.score * entered;
  const pace = exercise.thresholds.filter(reaches).at(-1) ?? null;
  const next = exercise.thresholds.find(threshold => !reaches(threshold)) ?? null;
  const remaining = exercise.arrows - entered;
  const remainingAverage = next && remaining > 0 ? Math.max(next.score - points, 0) / remaining : null;
  return { exercise, points, entered, average, projected, complete, pace, next, result: complete ? pace : null, remainingAverage };
}

export type StageRank = {
  evaluation: RankEvaluation | null;
  reason: string | null;
  scopeLabel: string;
  label: string | null;
  classLabel: string | null;
  bow: RankBow | null;
  category: RankCategory | null;
  conditions: Conditions | null;
  finalResult: boolean;
};

function rankBow(conditions: Conditions | null): RankBow | null {
  const value = conditions?.equipment?.bow.category;
  return value === 'recurve' || value === 'compound' || value === 'barebow' ? value : null;
}

function sameRankConditions(a: Conditions, b: Conditions): boolean {
  return (a.equipment?.bow.category ?? null) === (b.equipment?.bow.category ?? null) &&
    a.distanceMeters === b.distanceMeters && a.targetProfileId === b.targetProfileId && a.targetDiameterMm === b.targetDiameterMm;
}

function stageRank(practice: Practice, round: Round | undefined, series: Series | null, category: RankCategory | null, scopeLabel: string): StageRank {
  const all = series ? [series] : round?.series ?? [];
  const enteredSeries = all.filter(item => item.shots.length > 0);
  // A new empty series carries the next conditions and contributes no arrows to the round sample.
  const sample = enteredSeries.length > 0 ? enteredSeries : all.slice(-1);
  const first = sample[0]?.conditions ?? null;
  const conditions = first && sample.every(item => sameRankConditions(first, item.conditions)) ? first : null;
  const bow = rankBow(conditions);
  const classLabel = bow && category ? `${bowClasses[bow]}(${category === 'male' ? 'М' : 'Ж'})` : null;
  const base = { scopeLabel, classLabel, bow, category, conditions };
  const unavailable = (reason: string): StageRank => ({ ...base, reason, evaluation: null, label: null, finalResult: false });
  if (!round || !first) return unavailable('Нет зачётных стрел');
  if (!conditions) return unavailable('В выборке разные условия. Норматив для неё недоступен.');
  if (!conditions.equipment?.bow.category) return unavailable('Укажи тип лука в снаряжении тренировки');
  if (!category) return unavailable('Выбери категорию сравнения');
  const candidates = matchingRankExercises(conditions, category);
  if (!candidates.length) return unavailable('Для этих условий пока нет поддерживаемого норматива');

  const roundClosed = practice.savedAt !== null || round !== practice.rounds.at(-1);
  const roundVolume = round.series.reduce((count, item) => count + item.shots.length, 0);
  const plannedVolume = practice.roundRule.unit === 'arrows' ? practice.roundRule.limit : null;
  const referenceVolume = plannedVolume ?? (roundClosed ? roundVolume : null);
  const longExercise = candidates.find(item => item.arrows === 60);
  const barebowForecast = bow === 'barebow' && conditions.distanceMeters === 18 ? longExercise : undefined;
  const exercise = barebowForecast ?? candidates.find(item => item.arrows === referenceVolume) ?? longExercise ?? candidates[0];
  const { points, entered } = sample.reduce((total, item) => ({
    points: total.points + summarize(item.shots).points,
    entered: total.entered + item.shots.length,
  }), { points: 0, entered: 0 });
  const evaluation = evaluateRank(exercise, points, entered);
  const finalResult = !series && roundClosed && evaluation.complete;
  return { ...base, reason: null, evaluation: { ...evaluation, result: finalResult ? evaluation.result : null },
    label: entered > 0 ? evaluation.pace?.label ?? 'ниже порога' : null, finalResult };
}

export function roundRank(practice: Practice, roundId: number, category: RankCategory | null): StageRank {
  const index = practice.rounds.findIndex(round => round.id === roundId);
  return stageRank(practice, practice.rounds[index], null, category, index < 0 ? 'Раунд' : `Раунд ${index + 1}`);
}

export function seriesRank(practice: Practice, seriesId: number, category: RankCategory | null): StageRank {
  const found = findSeries(practice, seriesId);
  const index = found ? found.round.series.indexOf(found.series) : -1;
  return stageRank(practice, found?.round, found?.series ?? null, category, index < 0 ? 'Серия' : `Серия ${index + 1}`);
}
