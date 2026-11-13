import { achievementRarityFor, achievementScopesFor, achievementTierOrder, ACHIEVEMENT_RARITY_ORDER, getAchievementDefinition } from './achievement-catalog.ts';
import type { RankCategory } from './sport-ranks.ts';
import type { StageRankBasis } from './stage-rank-achievements.ts';

export type AchievementEnrollment = { epoch: string; rankCategory: RankCategory | null; stageRankVersion?: 1; roomAwards?: true;
  stageRankCategories?: Record<string, RankCategory | null> };
export type AchievementGrant = { id: string; scope: string; earnedAt: string; sessionId?: string; notifiedAt?: string; valid?: boolean; nativeSnapshot?: true; stageRank?: StageRankBasis };
export type AchievementLedger = { epoch: string; grants: AchievementGrant[]; publications?: { documentId: string; fingerprint: string }[] };
export type AchievementObservation = { id: string; scope: string; progress: number; stageRank?: StageRankBasis };

const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;

export function isAchievementEnrollment(value: unknown): value is AchievementEnrollment {
  if (!value || typeof value !== 'object') return false;
  const enrollment = value as Partial<AchievementEnrollment>;
  const categories = enrollment.stageRankCategories;
  return identity(enrollment.epoch) && (enrollment.roomAwards === undefined || enrollment.roomAwards === true) &&
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
      (grant.sessionId !== undefined && !identity(grant.sessionId)) ||
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
      ...(observation.stageRank ? { stageRank: observation.stageRank } : {}) });
    keys.add(key);
  }
  return { ledger: added.length ? { ...ledger, grants: [...ledger.grants, ...added] } : ledger, added };
}

export type AchievementGroup = { key: string; leading: AchievementGrant; additional: AchievementGrant[] };

export function recentAchievementNotices(ledger: AchievementLedger | undefined, nowMs = Date.now()): AchievementGroup[] {
  return groupAchievementGrants(ledger?.grants.filter(grant => !grant.nativeSnapshot && !grant.notifiedAt &&
    nowMs - Date.parse(grant.earnedAt) >= 0 && nowMs - Date.parse(grant.earnedAt) <= 10_000) ?? []);
}

/** Coalesce families still waiting to be shown without dropping the lower earned tiers. */
export function queueAchievementGrants(queue: readonly AchievementGroup[], grants: readonly AchievementGrant[]): AchievementGroup[] {
  const unique = new Map<string, AchievementGrant>();
  for (const grant of [...queue.flatMap(group => [group.leading, ...group.additional]), ...grants]) {
    unique.set(`${grant.id}:${grant.scope}`, grant);
  }
  return groupAchievementGrants([...unique.values()]);
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
