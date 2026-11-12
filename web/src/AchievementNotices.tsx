import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { ACHIEVEMENT_RARITY_LABELS, achievementRarityFor, achievementScopeLabel, getAchievementDefinition } from './achievement-catalog.ts';
import { stageRankBasisLabel } from './stage-rank-achievements.ts';
import { groupAchievementGrants } from './achievement-ledger.ts';
import type { AchievementGrant, AchievementGroup } from './achievement-ledger.ts';
import './achievement-notices.css';

function GrantTitle({ grant }: { grant: AchievementGrant }) {
  const rule = getAchievementDefinition(grant.id)!;
  return <><strong>{rule.title}</strong><span>{grant.valid === false ? 'Сейчас не подтверждено' : ACHIEVEMENT_RARITY_LABELS[achievementRarityFor(rule, grant.scope)]}</span></>;
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
      data-rarity={achievementRarityFor(getAchievementDefinition(group.leading.id)!, group.leading.scope)}>
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
      <ul className="achievement-earned-list">{[group.leading, ...group.additional].map(grant => <li key={grant.id}>
        <GrantTitle grant={grant} /><p>{getAchievementDefinition(grant.id)?.flavor}</p>
      </li>)}</ul>
      <button type="button" className="primary" onClick={onNext}>Дальше</button>
    </BottomSheet>}
  </>;
}

export function SessionAchievements({ grants }: { grants: readonly AchievementGrant[] }) {
  const [expanded, setExpanded] = useState<AchievementGroup | null>(null);
  const groups = groupAchievementGrants(grants);
  if (!groups.length) return null;
  return <section className="report-metrics-card" data-testid="session-achievements">
    <h3>Достижения тренировки</h3>
    {groups.map(group => <button type="button" className="achievement-earned-row" key={group.key} onClick={() => setExpanded(group)}>
      <GrantTitle grant={group.leading} />{!!group.additional.length && <b>+{group.additional.length}</b>}
    </button>)}
    {expanded && <BottomSheet title="Достижения тренировки" onClose={() => setExpanded(null)}>
      <ul className="achievement-earned-list">{[expanded.leading, ...expanded.additional].map(grant => <li key={grant.id}>
        <GrantTitle grant={grant} /><p>{getAchievementDefinition(grant.id)?.description}</p>
        {grant.stageRank && <small>{achievementScopeLabel(grant.scope)} · {stageRankBasisLabel(grant.stageRank)}</small>}
      </li>)}</ul>
    </BottomSheet>}
  </section>;
}
