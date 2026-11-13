import { useId, useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import { ACHIEVEMENT_BOW_LABELS, ACHIEVEMENT_CATALOG, ACHIEVEMENT_RARITY_LABELS, ACHIEVEMENT_RARITY_ORDER,
  achievementRarityFor, achievementScopeBow, achievementScopeLabel, achievementScopesFor, achievementTierOrder, getAchievementDefinition } from './achievement-catalog.ts';
import type { AchievementBowScope, AchievementDefinition, AchievementRarity, AchievementScope } from './achievement-catalog.ts';
import { groupAchievementGrants } from './achievement-ledger.ts';
import type { AchievementGrant } from './achievement-ledger.ts';
import { stageRankBasisLabel } from './stage-rank-achievements.ts';
import './achievement-gallery.css';

export type AchievementGalleryGrant = AchievementGrant;
export type AchievementGalleryProgress = { id: string; scope: string; progress: number };
export type AchievementGalleryProps = {
  grants: readonly AchievementGalleryGrant[];
  progress: readonly AchievementGalleryProgress[];
  availableRuleIds?: readonly string[];
  onBack: () => void;
};

type ScopeFilter = AchievementBowScope | 'global' | 'all';
type Status = {
  rule: AchievementDefinition;
  scope: AchievementScope;
  rarity: AchievementRarity;
  grant?: AchievementGalleryGrant;
  progress?: number;
};
type Family = {
  key: string;
  scope: AchievementScope;
  main: Status;
  earned: Status[];
  next?: Status;
  locked: Status[];
};

const scopeLabels = { all: 'Все', global: 'Общие', ...ACHIEVEMENT_BOW_LABELS } as const;
const scopeOptions = Object.keys(scopeLabels) as ScopeFilter[];
const day = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' });
const moment = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const number = new Intl.NumberFormat('ru-RU');
const evidenceKey = (id: string, scope: string) => `${id}:${scope}`;
const rarityIndex = (rarity: AchievementRarity) => ACHIEVEMENT_RARITY_ORDER.indexOf(rarity);

function byTier(a: Status, b: Status) {
  return achievementTierOrder(a.rule) - achievementTierOrder(b.rule) || a.rule.id.localeCompare(b.rule.id);
}

function byRarity(a: Status, b: Status) {
  return rarityIndex(b.rarity) - rarityIndex(a.rarity) ||
    achievementTierOrder(b.rule) - achievementTierOrder(a.rule) || a.rule.id.localeCompare(b.rule.id);
}

function evidenceMatches(id: string, scope: string): scope is AchievementScope {
  const rule = getAchievementDefinition(id);
  return !!rule && achievementScopesFor(rule).some(candidate => candidate === scope);
}

function familiesFor(grants: readonly AchievementGalleryGrant[], progress: readonly AchievementGalleryProgress[], selected: ScopeFilter,
  availableRuleIds?: readonly string[]): Family[] {
  const available = availableRuleIds && new Set(availableRuleIds);
  const received = new Map<string, AchievementGalleryGrant>();
  const measured = new Map<string, number>();
  const activeScopes = new Set<AchievementScope>(['global']);
  for (const grant of grants) {
    const date = Date.parse(grant.earnedAt);
    if (!evidenceMatches(grant.id, grant.scope) || !Number.isFinite(date)) continue;
    activeScopes.add(grant.scope);
    const key = evidenceKey(grant.id, grant.scope), previous = received.get(key);
    if (!previous || date < Date.parse(previous.earnedAt)) received.set(key, grant);
  }
  for (const item of progress) {
    if (available && !available.has(item.id) || !evidenceMatches(item.id, item.scope) || !Number.isFinite(item.progress) || item.progress < 0) continue;
    activeScopes.add(item.scope);
    const key = evidenceKey(item.id, item.scope);
    measured.set(key, Math.max(item.progress, measured.get(key) ?? 0));
  }
  const groups = new Map<string, Status[]>();
  for (const rule of ACHIEVEMENT_CATALOG) for (const scope of achievementScopesFor(rule)) {
    if (selected === 'all' ? !activeScopes.has(scope) : selected !== achievementScopeBow(scope)) continue;
    const key = evidenceKey(rule.id, scope);
    const grant = received.get(key);
    if (available && !available.has(rule.id) && !grant) continue;
    const group = evidenceKey(rule.family, scope);
    const status = { rule, scope, rarity: achievementRarityFor(rule, scope), grant, progress: measured.get(key) };
    const statuses = groups.get(group);
    if (statuses) statuses.push(status);
    else groups.set(group, [status]);
  }
  return [...groups].map(([key, statuses]) => {
    const earned = statuses.filter(item => !!item.grant).sort(byRarity);
    const upcoming = statuses.filter(item => !item.grant).sort(byTier);
    const main = earned[0] ?? upcoming[0];
    return { key, scope: main.scope, main, earned, next: upcoming[0], locked: upcoming.slice(1).sort(byRarity) };
  }).sort((a, b) => rarityIndex(b.main.rarity) - rarityIndex(a.main.rarity) ||
    Number(!!b.main.grant) - Number(!!a.main.grant) || a.key.localeCompare(b.key));
}

const glyphs = {
  trophy: 'M8 4h8v8a4 4 0 0 1-8 0V4Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 4v4m-4 0h8',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2M5 10h14v10H5z',
  check: 'm5 12 5 5 9-10',
  next: 'M5 12h14m-6-6 6 6-6 6',
} as const;

function Glyph({ name }: { name: keyof typeof glyphs }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={glyphs[name]} /></svg>;
}

function Received({ grant, precise = false }: { grant: AchievementGalleryGrant; precise?: boolean }) {
  return <span className={`achievement-state ${grant.valid === false ? 'achievement-state-unconfirmed' : 'achievement-state-earned'}`} data-testid={`${precise ? 'achievement-moment' : 'achievement-earned'}-${grant.id}`}>
    <Glyph name="check" />
    <span>Получено <time dateTime={grant.earnedAt}>{(precise ? moment : day).format(new Date(grant.earnedAt))}</time>
      {precise && grant.valid === false && <small> · Текущие записи больше не подтверждают условие</small>}</span>
  </span>;
}

function StatusHeading({ status, id }: { status: Status; id?: string }) {
  return <span className="achievement-heading" data-rarity={status.rarity}>
    <span className="achievement-medal"><Glyph name="trophy" /></span>
    <span><strong id={id}>{status.rule.title}</strong><small>{ACHIEVEMENT_RARITY_LABELS[status.rarity]}</small></span>
  </span>;
}

function Progress({ status }: { status: Status }) {
  if (status.progress === undefined) return null;
  const goal = Math.max(1, status.rule.target);
  const value = Math.min(status.progress, goal);
  return <span className="achievement-progress">
    <small>{number.format(value)} из {number.format(goal)}</small>
    <progress max={goal} value={value} aria-label={`Прогресс: ${status.rule.title}`} />
  </span>;
}

function NextState({ status }: { status: Status }) {
  return <span className="achievement-state achievement-state-next">
    <Glyph name="next" />{(status.progress ?? 0) > 0 ? 'Следующая ступень · В процессе' : 'Следующая ступень'}
  </span>;
}

function LockedState() {
  return <span className="achievement-state"><Glyph name="lock" />Закрыто · позже</span>;
}

function FamilyCard({ family, earnedOnly, onOpen }: { family: Family; earnedOnly: boolean; onOpen: () => void }) {
  const id = useId();
  const { main, next, earned, locked, scope } = family;
  return <button type="button" className="achievement-card" data-earned={!!main.grant} data-rarity={main.rarity}
    data-testid={`achievement-${main.rule.id}`} data-scope={scope} aria-labelledby={`${id}-name ${id}-scope`} aria-haspopup="dialog" onClick={onOpen}>
    <span className="achievement-card-meta">
      <small id={`${id}-scope`}>{achievementScopeLabel(scope)}</small>
      {earned.length > 1 && <small className="achievement-earned-count">Получено ступеней: {earned.length}</small>}
    </span>
    <StatusHeading status={main} id={`${id}-name`} />
    {main.grant ? <Received grant={main.grant} /> : <span className="achievement-next-main" data-testid={`achievement-next-${main.rule.id}`}>
      <NextState status={main} /><Progress status={main} />
    </span>}
    <span className="achievement-flavor">{main.rule.flavor}</span>
    {!earnedOnly && main.grant && next && <span className="achievement-next" data-testid={`achievement-next-${next.rule.id}`}>
      <NextState status={next} /><strong>{next.rule.title}</strong><Progress status={next} />
    </span>}
    {!earnedOnly && locked.slice(0, 2).map(status => <span className="achievement-locked" data-testid={`achievement-locked-${status.rule.id}`} key={status.rule.id}>
      <LockedState /><small>{status.rule.title} · {ACHIEVEMENT_RARITY_LABELS[status.rarity]}</small>
    </span>)}
    {locked.length > 2 && !earnedOnly && <span className="achievement-more">Все ступени <Icon name="right" /></span>}
  </button>;
}

function FamilyDetails({ family, onClose }: { family: Family; onClose: () => void }) {
  const levels = [...family.earned, ...(family.next ? [family.next] : []), ...family.locked];
  return <BottomSheet title={family.main.rule.title} onClose={onClose} tag="achievement-details">
    <div className="achievement-details">
      <p className="achievement-detail-scope">{family.scope === 'global' ? 'Общее достижение' : achievementScopeLabel(family.scope)}</p>
      {levels.map(status => {
        const isNext = status === family.next;
        return <article className="achievement-detail" data-testid={`achievement-detail-${status.rule.id}`} data-state={status.grant ? 'earned' : isNext ? 'next' : 'locked'} key={status.rule.id}>
          <StatusHeading status={status} />
          {status.grant ? <Received grant={status.grant} precise /> : isNext ? <NextState status={status} /> : <LockedState />}
          <p className="achievement-flavor">{status.rule.flavor}</p>
          <p className="achievement-requirement">{status.rule.description}</p>
          {status.grant?.stageRank && <small>{stageRankBasisLabel(status.grant.stageRank)}</small>}
          {isNext && <Progress status={status} />}
        </article>;
      })}
      <button type="button" className="achievement-close" data-testid="achievement-details-close" onClick={onClose}>Закрыть</button>
    </div>
  </BottomSheet>;
}

export function ProfileAchievements({ grants, showEarned, onOpen }: {
  grants: readonly AchievementGalleryGrant[]; showEarned: boolean; onOpen: () => void;
}) {
  const [opened, setOpened] = useState<Family | null>(null);
  const groups = showEarned ? groupAchievementGrants(grants).slice(0, 4) : [];
  return <section className="profile-panel profile-achievements" data-testid="profile-achievements">
    <h2 className="profile-achievements-heading"><Icon name="trophy" />Достижения{showEarned && <span>{grants.length}</span>}</h2>
    {showEarned && groups.length === 0 && <p>Пока нет полученных</p>}
    {groups.map(group => {
      const earned = [group.leading, ...group.additional];
      const family = familiesFor(earned, [], 'all', earned.map(grant => grant.id)).find(item => item.key === group.key);
      if (!family) return null;
      return <button type="button" className="profile-achievement-row" key={group.key} aria-haspopup="dialog"
        onClick={() => setOpened(family)}>
        <StatusHeading status={family.main} />
        {family.scope !== 'global' && <small>{achievementScopeLabel(family.scope)}</small>}
        {group.additional.length > 0 && <small>+{group.additional.length}</small>}
      </button>;
    })}
    <button className="profile-achievements-link" type="button" onClick={onOpen}>Все достижения</button>
    {opened && <FamilyDetails family={opened} onClose={() => setOpened(null)} />}
  </section>;
}

export function AchievementGallery({ grants, progress, availableRuleIds, onBack }: AchievementGalleryProps) {
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [earnedOnly, setEarnedOnly] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const families = useMemo(() => familiesFor(grants, progress, scope, availableRuleIds), [grants, progress, scope, availableRuleIds]);
  const shown = earnedOnly ? families.filter(family => family.earned.length > 0) : families;
  const details = families.find(family => family.key === opened);
  return <main className="conditions-page achievement-gallery" data-testid="achievements-screen">
    <header className="topbar"><button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button><h1>Достижения</h1></header>
    <div className="conditions-content achievement-content">
      <div className="achievement-filters" role="group" aria-label="Категория достижений">
        {scopeOptions.map(option => <button type="button" key={option} aria-pressed={scope === option} data-testid={`achievement-scope-${option}`}
          onClick={() => setScope(option)}>{scopeLabels[option]}</button>)}
      </div>
      <div className="achievement-filters" role="group" aria-label="Ступени достижений">
        <button type="button" aria-pressed={!earnedOnly} data-testid="achievements-all" onClick={() => setEarnedOnly(false)}>Все ступени</button>
        <button type="button" aria-pressed={earnedOnly} data-testid="achievements-earned" onClick={() => setEarnedOnly(true)}>Получены</button>
      </div>
      {shown.length === 0 && <p className="achievement-empty" role="status">
        {earnedOnly ? 'В этой категории пока нет полученных достижений.' : 'Для этой категории пока нет доступных достижений.'}
      </p>}
      <div className="achievement-cards">
        {shown.map(family => <FamilyCard key={family.key} family={family} earnedOnly={earnedOnly} onOpen={() => setOpened(family.key)} />)}
      </div>
    </div>
    {details && <FamilyDetails family={details} onClose={() => setOpened(null)} />}
  </main>;
}
