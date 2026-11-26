import { useId, useState } from 'react';
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
    <span className="achievement-heading-text"><strong id={id}>{rule.title}</strong><small>{ACHIEVEMENT_RARITY_LABELS[rarity]}</small></span>
  </span>;
}

function TierButton({ grant, onOpen, buttonProps }: {
  grant: AchievementGrant; onOpen: (grant: AchievementGrant) => void;
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const rule = getAchievementDefinition(grant.id)!;
  return <button type="button" aria-haspopup="dialog" onClick={() => onOpen(grant)} {...buttonProps} className="achievement-tier-open">
    <AchievementHeading rule={rule} rarity={grantRarity(grant)} />
    <span className="achievement-tier-arrow"><Icon name="right" /></span>
  </button>;
}

export function AchievementStack({ group, onOpen, variant, rootProps, leadingContent, active = true, onExpandedChange }: {
  group: AchievementGroup; onOpen: (grant: AchievementGrant) => void;
  variant?: 'profile' | 'notice'; rootProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  leadingContent?: ReactNode; active?: boolean; onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const { leading, additional } = group;
  const open = expanded && active;
  return <div className="achievement-stack" data-variant={variant}>
    <div className="achievement-tier achievement-stack-leading" data-rarity={grantRarity(leading)}>
      <TierButton grant={leading} onOpen={onOpen} buttonProps={rootProps} />
      {additional.length > 0 && <button type="button" className="achievement-stack-toggle" aria-expanded={open} aria-controls={id}
        aria-label={open ? 'Свернуть младшие награды' : `Раскрыть младшие награды, ${additional.length}`}
        onClick={() => { setExpanded(!expanded); onExpandedChange?.(!expanded); }}>
        <b>+{additional.length}</b><Icon name="right" />
      </button>}
      {leadingContent}
    </div>
    {additional.length > 0 && <div className="achievement-stack-tail" data-open={open} id={id} inert={!open}>
      <div><ul className="achievement-tier-list">{additional.map(grant => <li className="achievement-tier" key={grant.id} data-rarity={grantRarity(grant)}>
        <TierButton grant={grant} onOpen={onOpen} />
      </li>)}</ul></div>
    </div>}
    {additional.length > 0 && !open && <div className="achievement-stack-peek" aria-hidden="true">
      {additional.slice(0, 2).map(grant => <span key={grant.id} data-rarity={grantRarity(grant)} />)}
    </div>}
  </div>;
}

export function AchievementConditions({ rule, scope, grant }: {
  rule: AchievementDefinition; scope: string; grant?: AchievementGrant;
}) {
  const swing = grant?.seriesSwing;
  return <details className="achievement-conditions">
    <summary>Условия получения</summary>
    <p>{rule.plainCondition}</p>
    <div className="achievement-criteria">
      <p>{rule.description}</p>
      {scope !== 'global' && <p>{achievementScopeLabel(scope)}</p>}
      {grant?.stageRank && <p>{stageRankBasisLabel(grant.stageRank)}</p>}
      {swing && <p>{swing.points.map(points => `${points}/${10 * swing.arrows}`).join(' → ')}</p>}
      {grant?.valid === false && <p>Текущие записи больше не подтверждают условие.</p>}
    </div>
  </details>;
}

export function AchievementGrantDetails({ grant, onClose }: { grant: AchievementGrant; onClose: () => void }) {
  const rule = getAchievementDefinition(grant.id)!;
  const date = new Date(grant.earnedAt);
  return <BottomSheet title={rule.title} onClose={onClose} tag="achievement-details">
    <article className="achievement-detail" data-testid={`achievement-detail-${rule.id}`} data-state="earned">
      <AchievementHeading rule={rule} rarity={grantRarity(grant)} shimmer />
      <span className="achievement-state">Получено <time dateTime={grant.earnedAt}>{date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</time></span>
      <p className="achievement-flavor">{rule.flavor}</p>
      <AchievementConditions rule={rule} scope={grant.scope} grant={grant} />
    </article>
  </BottomSheet>;
}
