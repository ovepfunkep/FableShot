import { useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import { ACHIEVEMENT_RARITY_LABELS, achievementRarityFor, achievementScopeLabel, getAchievementDefinition } from './achievement-catalog.ts';
import type { AchievementDefinition, AchievementRarity } from './achievement-catalog.ts';
import type { AchievementGrant, AchievementGroup } from './achievement-ledger.ts';
import { stageRankBasisLabel } from './stage-rank-achievements.ts';
import './achievement-stack.css';

export const grantRarity = (grant: AchievementGrant) => achievementRarityFor(getAchievementDefinition(grant.id)!, grant.scope);

export function AchievementHeading({ rule, rarity, id, shimmer = false }: {
  rule: AchievementDefinition; rarity: AchievementRarity; id?: string; shimmer?: boolean;
}) {
  return <span className="achievement-heading" data-rarity={rarity}>
    <span className="achievement-medal" data-shimmer={shimmer || undefined}><Icon name="trophy" /></span>
    <span className="achievement-heading-text"><strong id={id}>{rule.title}</strong><small>{ACHIEVEMENT_RARITY_LABELS[rarity]}</small>
      <span className="achievement-short-condition">{rule.plainCondition}</span></span>
  </span>;
}

function TierButton({ grant, onOpen, buttonProps }: {
  grant: AchievementGrant; onOpen: (grant: AchievementGrant) => void;
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const rule = getAchievementDefinition(grant.id)!;
  return <button type="button" aria-label={rule.title} aria-haspopup="dialog" onClick={() => onOpen(grant)} {...buttonProps} className="achievement-tier-open">
    <AchievementHeading rule={rule} rarity={grantRarity(grant)} shimmer />
    <span className="achievement-tier-arrow"><Icon name="right" /></span>
  </button>;
}

export function AchievementTierList({ grants, onOpen }: {
  grants: readonly AchievementGrant[]; onOpen: (grant: AchievementGrant) => void;
}) {
  return <ul className="achievement-tier-list">{grants.map(level => <li className="achievement-tier" key={level.id} data-rarity={grantRarity(level)}>
    <TierButton grant={level} onOpen={onOpen} />
  </li>)}</ul>;
}

export function AchievementStack({ group, onOpen, variant, rootProps, leadingContent }: {
  group: AchievementGroup; onOpen: (grant: AchievementGrant) => void;
  variant?: 'profile' | 'notice'; rootProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  leadingContent?: ReactNode;
}) {
  const { leading, additional } = group;
  return <div className="achievement-stack" data-variant={variant}>
    <div className="achievement-tier achievement-stack-leading" data-rarity={grantRarity(leading)}>
      <TierButton grant={leading} onOpen={onOpen} buttonProps={rootProps} />
      {additional.length > 0 && <button type="button" className="achievement-stack-toggle" aria-haspopup="dialog"
        aria-label={`Посмотреть достижение и ещё ${additional.length} уровней`}
        onClick={() => onOpen(leading)}>
        <b>+{additional.length}</b><Icon name="right" />
      </button>}
      {leadingContent}
    </div>
    {additional.length > 0 && <div className="achievement-stack-peek" aria-hidden="true">
      {additional.slice(0, 2).map(grant => <span key={grant.id} data-rarity={grantRarity(grant)} />)}
    </div>}
  </div>;
}

export function AchievementConditions({ rule, scope, grant }: {
  rule: AchievementDefinition; scope: string; grant?: AchievementGrant;
}) {
  const swing = grant?.seriesSwing;
  return <details className="achievement-conditions">
    <summary>Точные условия</summary>
    <div className="achievement-criteria">
      <p>{rule.description}</p>
      {scope !== 'global' && <p>{achievementScopeLabel(scope)}</p>}
      {grant?.stageRank && <p>{stageRankBasisLabel(grant.stageRank)}</p>}
      {swing && <p>{swing.points.map(points => `${points}/${10 * swing.arrows}`).join(' → ')}</p>}
      {grant?.valid === false && <p>Текущие записи больше не подтверждают условие.</p>}
    </div>
  </details>;
}

export function AchievementGrantDetails({ grant, additional = [], onClose }: {
  grant: AchievementGrant; additional?: readonly AchievementGrant[]; onClose: () => void;
}) {
  const [selected, setSelected] = useState<AchievementGrant | null>(null);
  const [expanded, setExpanded] = useState(false);
  const current = selected ?? grant;
  const rule = getAchievementDefinition(current.id)!;
  const date = new Date(current.earnedAt);
  return <BottomSheet title={rule.title} onClose={() => selected ? setSelected(null) : onClose()} tag="achievement-details">
    {selected && <button type="button" className="text-action" onClick={() => setSelected(null)}>Ко всем уровням</button>}
    <article className="achievement-detail" data-testid={`achievement-detail-${rule.id}`} data-state="earned" data-rarity={grantRarity(current)}>
      <AchievementHeading rule={rule} rarity={grantRarity(current)} shimmer />
      <span className="achievement-state">Получено <time dateTime={grant.earnedAt}>{date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</time></span>
      <p className="achievement-flavor">{rule.flavor}</p>
      <AchievementConditions rule={rule} scope={current.scope} grant={current} />
    </article>
    {!selected && additional.length > 0 && <div>
      <button type="button" className="text-action achievement-level-toggle" aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}>{expanded ? 'Свернуть уровни' : `Ещё уровни · ${additional.length}`} <Icon name="right" /></button>
      {expanded && <AchievementTierList grants={additional} onOpen={setSelected} />}
    </div>}
  </BottomSheet>;
}
