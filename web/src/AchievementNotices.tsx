import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { ACHIEVEMENT_RARITY_LABELS, achievementRarityFor, achievementScopeLabel, getAchievementDefinition } from './achievement-catalog.ts';
import { stageRankBasisLabel } from './stage-rank-achievements.ts';
import { groupAchievementGrants } from './achievement-ledger.ts';
import type { AchievementGrant, AchievementGroup } from './achievement-ledger.ts';
import { Icon } from './TrainingChrome.tsx';
import './achievement-notices.css';

const rarity = (grant: AchievementGrant) => achievementRarityFor(getAchievementDefinition(grant.id)!, grant.scope);

function GrantTitle({ grant }: { grant: AchievementGrant }) {
  return <><strong>{getAchievementDefinition(grant.id)!.title}</strong><span className="achievement-rarity-label">{ACHIEVEMENT_RARITY_LABELS[rarity(grant)]}</span></>;
}

function GrantList({ grants, flavor = false }: { grants: readonly AchievementGrant[]; flavor?: boolean }) {
  return <ul className="achievement-earned-list">{grants.map(grant => {
    const rule = getAchievementDefinition(grant.id)!;
    return <li key={`${grant.id}:${grant.scope}`} className="achievement-earned-card" data-rarity={rarity(grant)}>
      <header><span className="achievement-earned-icon"><Icon name="trophy" /></span><div><GrantTitle grant={grant} /></div></header>
      <p>{flavor ? rule.flavor : rule.description}</p>
      {grant.stageRank && <small>{achievementScopeLabel(grant.scope)} · {stageRankBasisLabel(grant.stageRank)}</small>}
      {grant.valid === false && <small className="achievement-evidence-note">Награда получена раньше. Текущие записи больше не подтверждают её условие.</small>}
    </li>;
  })}</ul>;
}

export function AchievementNotice({ group, onNext, onShown }: { group: AchievementGroup; onNext: () => void; onShown: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const next = useRef(onNext);
  next.current = onNext;
  useEffect(() => { onShown(); }, []);
  useEffect(() => {
    if (expanded) return;
    const timer = window.setTimeout(() => next.current(), 4000);
    return () => window.clearTimeout(timer);
  }, [expanded]);
  return <>
    <aside className="achievement-notice" aria-label="Новое достижение" data-testid="achievement-notice"
      data-rarity={rarity(group.leading)}>
      <button type="button" aria-label="Подробнее о достижении" onClick={() => { if (!swiped.current) setExpanded(true); swiped.current = false; }}
        onPointerDown={event => { swiped.current = false; start.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={event => {
          const point = start.current;
          if (point && (point.x - event.clientX > 55 || point.y - event.clientY > 45)) { swiped.current = true; onNext(); }
          start.current = null;
        }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8" /></svg>
        <div><GrantTitle grant={group.leading} /></div>
        {!!group.additional.length && <b>+{group.additional.length}</b>}
      </button>
      {!expanded && <svg className="achievement-notice-clock" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">
        <rect x=".7" y=".7" width="98.6" height="20.6" rx="4" pathLength="1" />
      </svg>}
    </aside>
    {expanded && <BottomSheet title="Полученные достижения" onClose={onNext}>
      <GrantList grants={[group.leading, ...group.additional]} flavor />
      <button type="button" className="primary" onClick={onNext}>Дальше</button>
    </BottomSheet>}
  </>;
}

export function SessionAchievements({ grants }: { grants: readonly AchievementGrant[] }) {
  const [expanded, setExpanded] = useState(false);
  const groups = groupAchievementGrants(grants);
  if (!groups.length) return null;
  const earned = groups.flatMap(group => [group.leading, ...group.additional]);
  return <section className="report-metrics-card" data-testid="session-achievements">
    <button type="button" className="achievement-earned-summary" aria-haspopup="dialog" onClick={() => setExpanded(true)}>
      <span className="achievement-earned-icon"><Icon name="trophy" /></span>
      <strong>Получено достижений: {earned.length}</strong><Icon name="right" />
    </button>
    {expanded && <BottomSheet title="Достижения тренировки" onClose={() => setExpanded(false)}>
      <GrantList grants={earned} />
    </BottomSheet>}
  </section>;
}
