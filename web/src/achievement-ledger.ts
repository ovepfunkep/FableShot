import { achievementRarityFor, achievementScopesFor, achievementTierOrder, ACHIEVEMENT_RARITY_ORDER, getAchievementDefinition } from './achievement-catalog.ts';
import type { RankCategory } from './sport-ranks.ts';
import type { StageRankBasis } from './stage-rank-achievements.ts';

export type AchievementEnrollment = { epoch: string; rankCategory: RankCategory | null; stageRankVersion?: 1; roomAwards?: true; seriesStories?: true;
  stageRankCategories?: Record<string, RankCategory | null> };
export type SeriesSwing = { seriesIds: number[]; points: number[]; arrows: number };
export type AchievementGrant = { id: string; scope: string; earnedAt: string; sessionId?: string; notifiedAt?: string; noticeMoment?: string; valid?: boolean; nativeSnapshot?: true; stageRank?: StageRankBasis; seriesSwing?: SeriesSwing };
export type AchievementLedger = { epoch: string; grants: AchievementGrant[]; publications?: { documentId: string; fingerprint: string }[] };
export type AchievementObservation = { id: string; scope: string; progress: number; stageRank?: StageRankBasis; seriesSwing?: SeriesSwing };

const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;

export function isAchievementEnrollment(value: unknown): value is AchievementEnrollment {
  if (!value || typeof value !== 'object') return false;
  const enrollment = value as Partial<AchievementEnrollment>;
  const categories = enrollment.stageRankCategories;
  return identity(enrollment.epoch) && (enrollment.roomAwards === undefined || enrollment.roomAwards === true) &&
    (enrollment.seriesStories === undefined || enrollment.seriesStories === true) &&
    (enrollment.rankCategory === null || enrollment.rankCategory === 'male' || enrollment.rankCategory === 'female') &&
    (enrollment.stageRankVersion === undefined || enrollment.stageRankVersion === 1) &&
    (categories === undefined || (enrollment.stageRankVersion === 1 && !!categories && typeof categories === 'object' &&
      !Array.isArray(categories) && Object.entries(categories).every(([id, category]) =>
        /^[1-9]\d*$/.test(id) && (category === null || category === 'male' || category === 'female'))));
}

function validStageRank(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const basis = value as StageRankBasis;
  const positive = (item: unknown) => Number.isSafeInteger(item) && Number(item) > 0;
  return [basis.roundId, basis.arrows, basis.exerciseArrows, basis.threshold, basis.distance, basis.diameter].every(positive) &&
    Array.isArray(basis.seriesIds) && basis.seriesIds.length > 0 && basis.seriesIds.every(positive) &&
    new Set(basis.seriesIds).size === basis.seriesIds.length && Number.isSafeInteger(basis.points) && basis.points >= 0 &&
    basis.points <= basis.arrows * 10 && basis.threshold <= basis.exerciseArrows * 10 &&
    [basis.revision, basis.target, basis.bow].every(identity);
}

function validSeriesSwing(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const basis = value as SeriesSwing;
  return Number.isSafeInteger(basis.arrows) && basis.arrows >= 3 &&
    Array.isArray(basis.seriesIds) && (basis.seriesIds.length === 2 || basis.seriesIds.length === 3) &&
    basis.seriesIds.every(id => Number.isSafeInteger(id) && id > 0) && new Set(basis.seriesIds).size === basis.seriesIds.length &&
    Array.isArray(basis.points) && basis.points.length === basis.seriesIds.length &&
    basis.points.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 10 * basis.arrows);
}

export function isAchievementLedger(value: unknown): value is AchievementLedger {
  if (!value || typeof value !== 'object') return false;
  const ledger = value as Partial<AchievementLedger>;
  if (!identity(ledger.epoch) || !Array.isArray(ledger.grants) || ledger.grants.length > 10_000) return false;
  if (ledger.publications !== undefined) {
    if (!Array.isArray(ledger.publications) || ledger.publications.length > 10_000) return false;
    const publications = new Set<string>();
    for (const item of ledger.publications) {
      if (!item || !identity(item.documentId) || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint)) return false;
      const key = `${item.documentId}:${item.fingerprint}`;
      if (publications.has(key)) return false;
      publications.add(key);
    }
  }
  const keys = new Set<string>();
  for (const grant of ledger.grants) {
    if (!grant || typeof grant.id !== 'string' || !/^[A-Z]+\d{2}$/.test(grant.id) || !identity(grant.scope) ||
      typeof grant.earnedAt !== 'string' || !Number.isFinite(Date.parse(grant.earnedAt)) ||
      (grant.valid !== undefined && typeof grant.valid !== 'boolean') ||
      (grant.nativeSnapshot !== undefined && grant.nativeSnapshot !== true) ||
      (grant.notifiedAt !== undefined && (typeof grant.notifiedAt !== 'string' || !Number.isFinite(Date.parse(grant.notifiedAt)))) ||
      (grant.noticeMoment !== undefined && !identity(grant.noticeMoment)) ||
      (grant.sessionId !== undefined && !identity(grant.sessionId)) ||
      (grant.seriesSwing !== undefined && (!identity(grant.sessionId) || !validSeriesSwing(grant.seriesSwing))) ||
      (grant.stageRank !== undefined && (!identity(grant.sessionId) || !validStageRank(grant.stageRank)))) return false;
    const key = `${grant.id}:${grant.scope}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

export function earnAchievements(ledger: AchievementLedger, observations: readonly AchievementObservation[], earnedAt: string, sessionId?: string) {
  const keys = new Set(ledger.grants.map(grant => `${grant.id}:${grant.scope}`));
  const added: AchievementGrant[] = [];
  for (const observation of observations) {
    const rule = getAchievementDefinition(observation.id);
    const key = `${observation.id}:${observation.scope}`;
    if (!rule || keys.has(key) || !Number.isFinite(observation.progress) || observation.progress < rule.target ||
      !achievementScopesFor(rule).some(scope => scope === observation.scope)) continue;
    added.push({ id: observation.id, scope: observation.scope, earnedAt, ...(sessionId ? { sessionId } : {}),
      ...(observation.stageRank ? { stageRank: observation.stageRank } : {}),
      ...(observation.seriesSwing ? { seriesSwing: observation.seriesSwing } : {}) });
    keys.add(key);
  }
  return { ledger: added.length ? { ...ledger, grants: [...ledger.grants, ...added] } : ledger, added };
}

export type AchievementGroup = { key: string; leading: AchievementGrant; additional: AchievementGrant[] };
export type AchievementMoment = { id: string; grants: AchievementGrant[] };
export const achievementReceiptKey = (grant: AchievementGrant) => JSON.stringify([grant.id, grant.scope, grant.noticeMoment, grant.earnedAt]);

export function recentAchievementNotices(ledger: AchievementLedger | undefined, nowMs = Date.now()): AchievementMoment[] {
  const moments = new Map<string, AchievementMoment>();
  for (const grant of ledger?.grants ?? []) {
    const age = nowMs - Date.parse(grant.earnedAt);
    if (grant.nativeSnapshot || age < 0 || age > 10_000) continue;
    const id = grant.noticeMoment ?? JSON.stringify([grant.earnedAt, grant.sessionId]);
    const moment = moments.get(id) ?? { id, grants: [] };
    moment.grants.push(grant);
    moments.set(id, moment);
  }
  return [...moments.values()].filter(moment => moment.grants.some(grant => !grant.notifiedAt));
}

export function groupAchievementGrants(grants: readonly AchievementGrant[]): AchievementGroup[] {
  const groups = new Map<string, AchievementGrant[]>();
  for (const grant of grants) {
    const rule = getAchievementDefinition(grant.id);
    if (!rule) continue;
    const key = `${rule.family}:${grant.scope}`;
    const items = groups.get(key) ?? [];
    items.push(grant);
    groups.set(key, items);
  }
  function compare(left: AchievementGrant, right: AchievementGrant) {
    const a = getAchievementDefinition(left.id)!;
    const b = getAchievementDefinition(right.id)!;
    return ACHIEVEMENT_RARITY_ORDER.indexOf(achievementRarityFor(b, right.scope)) -
      ACHIEVEMENT_RARITY_ORDER.indexOf(achievementRarityFor(a, left.scope)) || achievementTierOrder(b) - achievementTierOrder(a);
  }
  return [...groups].map(([key, items]) => {
    items.sort(compare);
    return { key, leading: items[0], additional: items.slice(1) };
  }).sort((left, right) => compare(left.leading, right.leading));
}
