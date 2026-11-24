import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
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

function GrantEvidence({ grant, compact = false }: { grant: AchievementGrant; compact?: boolean }) {
  const swing = grant.seriesSwing;
  return <>
    {grant.stageRank && <small>{compact ? `Порог ${grant.stageRank.threshold} из ${10 * grant.stageRank.exerciseArrows}`
      : `${achievementScopeLabel(grant.scope)} · ${stageRankBasisLabel(grant.stageRank)}`}</small>}
    {swing && <small>{swing.points.map(points => `${points}/${10 * swing.arrows}`).join(' → ')}</small>}
    {grant.valid === false && <small className="achievement-evidence-note">Награда получена раньше. Текущие записи больше не подтверждают её условие.</small>}
  </>;
}

function GrantList({ grants, flavor = false, compact = false }: { grants: readonly AchievementGrant[]; flavor?: boolean; compact?: boolean }) {
  return <ul className="achievement-earned-list">{grants.map(grant => {
    const rule = getAchievementDefinition(grant.id)!;
    return <li key={`${grant.id}:${grant.scope}`} className="achievement-earned-card" data-rarity={rarity(grant)}>
      <header><span className="achievement-earned-icon"><Icon name="trophy" /></span><div><GrantTitle grant={grant} /></div></header>
      <p>{flavor ? rule.flavor : rule.description}</p>
      <GrantEvidence grant={grant} compact={compact} />
    </li>;
  })}</ul>;
}

const noticeDuration = 4000;
const noticeEnter = 170;
const noticeExit = 190;
const groupGrants = (group: AchievementGroup) => [group.leading, ...group.additional];
const animated = () => document.documentElement.dataset.motion !== 'off' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function AchievementBanner({ group, compact, onOpen, onNext, onShown }: {
  group: AchievementGroup; compact?: boolean; onOpen: () => void; onNext: () => void; onShown: () => void;
}) {
  const banner = useRef<HTMLElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<'up' | 'left'>();
  const remaining = useRef(noticeDuration + (animated() ? noticeEnter : 0));
  const next = useRef(onNext);
  const shown = useRef(onShown);
  next.current = onNext;
  shown.current = onShown;
  useEffect(() => { shown.current(); }, []);
  useEffect(() => {
    if (leaving) {
      if (!animated()) { next.current(); return; }
      const end = window.setTimeout(() => next.current(), noticeExit);
      return () => window.clearTimeout(end);
    }
    if (dragging) return;
    const started = Date.now();
    const timer = window.setTimeout(() => setLeaving('up'), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [dragging, leaving]);

  function finishDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const point = start.current;
    if (!point || point.id !== event.pointerId) return;
    start.current = null;
    const x = point.x - event.clientX;
    const y = point.y - event.clientY;
    suppressClick.current = cancelled || Math.hypot(x, y) > 10;
    setDragging(false);
    if (!cancelled && (x > 55 || y > 45)) {
      suppressClick.current = true;
      setLeaving(x > y ? 'left' : 'up');
      return;
    }
    banner.current?.style.removeProperty('--notice-x');
    banner.current?.style.removeProperty('--notice-y');
  }

  return <aside ref={banner} className="achievement-notice" aria-label="Новое достижение" data-testid="achievement-notice"
    data-rarity={rarity(group.leading)} data-compact={compact || undefined} data-dragging={dragging || undefined} data-leaving={leaving}
    onAnimationEnd={event => {
      if (event.target === event.currentTarget && event.animationName === 'achievement-notice-in') banner.current?.setAttribute('data-arrived', '');
    }}>
    <button type="button" aria-label="Посмотреть полученные достижения" aria-haspopup="dialog" onClick={() => {
      if (!suppressClick.current && !leaving) onOpen();
      suppressClick.current = false;
    }} onPointerDown={event => {
      if (leaving || event.button !== 0 || start.current) return;
      suppressClick.current = false;
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      banner.current?.setAttribute('data-arrived', '');
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }} onPointerMove={event => {
      const point = start.current;
      if (!point || point.id !== event.pointerId || !animated()) return;
      const x = Math.min(0, event.clientX - point.x);
      const y = Math.min(0, event.clientY - point.y);
      banner.current?.style.setProperty('--notice-x', `${x}px`);
      banner.current?.style.setProperty('--notice-y', `${y}px`);
    }} onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)}
      onLostPointerCapture={event => finishDrag(event, true)}>
      <Icon name="trophy" />
      <div><GrantTitle grant={group.leading} /></div>
      {!!group.additional.length && <b>+{group.additional.length}</b>}
    </button>
    <svg className="achievement-notice-clock" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">
      <rect x=".7" y=".7" width="98.6" height="20.6" rx="4" pathLength="1" />
    </svg>
  </aside>;
}

function groupTitle(grant: AchievementGrant) {
  const family = getAchievementDefinition(grant.id)!.family;
  if (family.startsWith('hits.') || family === 'score.average') return 'Попадания';
  if (family.startsWith('rank.') || family === 'norms') return 'Норматив';
  if (family.startsWith('story.')) return 'Сюжет серии';
  if (family.startsWith('room.')) return 'Групповая тренировка';
  if (family.startsWith('gear.')) return 'Снаряжение';
  return ({ group: 'Кучность', stability: 'Стабильность', records: 'Личный рекорд', progress: 'Прогресс' } as Record<string, string>)[family] ?? 'Дневник';
}

function AchievementStack({ group, active }: { group: AchievementGroup; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const { leading, additional } = group;
  const rule = getAchievementDefinition(leading.id)!;
  return <div className="achievement-stack">
    <div className="achievement-earned-card achievement-stack-leading" data-rarity={rarity(leading)}>
      <div className="achievement-stack-heading">
        <span className="achievement-earned-icon"><Icon name="trophy" /></span>
        <div><GrantTitle grant={leading} /></div>
      </div>
      <p>{rule.flavor}</p>
      <GrantEvidence grant={leading} />
      {!!additional.length && <button type="button" className="achievement-stack-toggle" aria-expanded={expanded} aria-controls={id}
        aria-label={expanded ? 'Свернуть младшие награды' : `Раскрыть младшие награды, ${additional.length}`}
        onClick={() => setExpanded(value => !value)}><b>+{additional.length}</b><Icon name="right" /></button>}
    </div>
    {!!additional.length && <div className="achievement-stack-tail" data-open={expanded && active} id={id} inert={!expanded || !active}>
      <div><GrantList grants={additional} flavor compact /></div>
    </div>}
    {!!additional.length && !expanded && <div className="achievement-stack-peek" aria-hidden="true">
      {additional.slice(0, 2).map(grant => <span key={grant.id} data-rarity={rarity(grant)} />)}
    </div>}
  </div>;
}

function AchievementMomentDetails({ groups, initial }: { groups: readonly AchievementGroup[]; initial: number }) {
  const pages = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(initial);
  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const viewport = pages.current;
      if (viewport) viewport.scrollLeft = initial * viewport.clientWidth;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initial]);
  function goTo(index: number) {
    const viewport = pages.current;
    if (viewport) viewport.scrollTo({ left: index * viewport.clientWidth, top: 0, behavior: animated() ? 'smooth' : 'instant' });
  }
  const total = groups.reduce((sum, group) => sum + 1 + group.additional.length, 0);
  return <div className="achievement-moment-details">
    <div className="achievement-moment-meta"><span>Получено наград · {total}</span>
      {groups.length > 1 && <span aria-live="polite">{page + 1} из {groups.length}</span>}
    </div>
    <div ref={pages} className="achievement-pages" onScroll={event => {
      const viewport = event.currentTarget;
      if (viewport.clientWidth) setPage(Math.min(groups.length - 1, Math.max(0, Math.round(viewport.scrollLeft / viewport.clientWidth))));
    }}>
      {groups.map((group, index) => <section className="achievement-page" key={group.key} inert={index !== page}>
        <h3>{groupTitle(group.leading)}</h3>
        <AchievementStack group={group} active={index === page} />
      </section>)}
    </div>
    {groups.length > 1 && <nav className="achievement-moment-nav" aria-label="Страницы наград">
      <button type="button" className="icon-button" disabled={page === 0} aria-label="Предыдущий тип наград" onClick={() => goTo(page - 1)}><Icon name="left" /></button>
      <span aria-hidden="true">{groups.map((group, index) => <i key={group.key} data-active={page === index} />)}</span>
      <button type="button" className="icon-button" disabled={page === groups.length - 1} aria-label="Следующий тип наград" onClick={() => goTo(page + 1)}><Icon name="right" /></button>
    </nav>}
  </div>;
}

export function AchievementNotice({ groups, compact, onNext, onShown }: {
  groups: readonly AchievementGroup[]; compact?: boolean; onNext: () => void; onShown: (grants: AchievementGrant[]) => void;
}) {
  const [seen, setSeen] = useState<string[]>([]);
  const [reading, setReading] = useState<string>();
  const waiting = groups.filter(group => !seen.includes(group.key) && groupGrants(group).some(grant => !grant.notifiedAt));
  const current = waiting[0];
  if (reading) return <BottomSheet title="Полученные достижения" onClose={onNext}>
    <AchievementMomentDetails groups={groups} initial={Math.max(0, groups.findIndex(group => group.key === reading))} />
  </BottomSheet>;
  if (!current) return null;
  return <AchievementBanner key={current.key} group={current} compact={compact} onShown={() => onShown(groupGrants(current))}
    onNext={() => waiting.length > 1 ? setSeen(keys => [...keys, current.key]) : onNext()}
    onOpen={() => {
      setReading(current.key);
      onShown(groups.flatMap(groupGrants));
    }} />;
}

export function SessionAchievements({ grants }: { grants: readonly AchievementGrant[] }) {
  const [expanded, setExpanded] = useState(false);
  const groups = groupAchievementGrants(grants);
  if (!groups.length) return null;
  const earned = groups.flatMap(group => [group.leading, ...group.additional]);
  return <span className="session-achievements-action" data-testid="session-achievements">
    <button type="button" aria-haspopup="dialog" onClick={() => setExpanded(true)}>
      <Icon name="trophy" /><span className="sr-only">Получено достижений: </span><strong>{earned.length}</strong>
    </button>
    {expanded && <BottomSheet title="Достижения тренировки" onClose={() => setExpanded(false)}>
      <GrantList grants={earned} />
    </BottomSheet>}
  </span>;
}
