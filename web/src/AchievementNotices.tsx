import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { getAchievementDefinition } from './achievement-catalog.ts';
import { AchievementGrantDetails, AchievementStack, grantRarity } from './AchievementStack.tsx';
import { groupAchievementGrants } from './achievement-ledger.ts';
import type { AchievementGrant, AchievementGroup } from './achievement-ledger.ts';
import { Icon } from './TrainingChrome.tsx';
import './achievement-notices.css';

const noticeDuration = 4000;
const noticeEnter = 170;
const noticeExit = 190;
const groupGrants = (group: AchievementGroup) => [group.leading, ...group.additional];
const animated = () => document.documentElement.dataset.motion !== 'off' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function AchievementBanner({ group, compact, onOpen, onNext, onShown }: {
  group: AchievementGroup; compact?: boolean; onOpen: (grant: AchievementGrant) => void; onNext: () => void; onShown: () => void;
}) {
  const banner = useRef<HTMLElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
    if (dragging || expanded) return;
    const started = Date.now();
    const timer = window.setTimeout(() => setLeaving('up'), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [dragging, expanded, leaving]);

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
    data-rarity={grantRarity(group.leading)} data-compact={compact || undefined} data-dragging={dragging || undefined} data-leaving={leaving} data-expanded={expanded || undefined}
    onAnimationEnd={event => {
      if (event.target === event.currentTarget && event.animationName === 'achievement-notice-in') banner.current?.setAttribute('data-arrived', '');
    }}>
    <AchievementStack group={group} variant="notice" onOpen={onOpen} onExpandedChange={setExpanded}
      rootProps={{ 'aria-label': 'Посмотреть полученные достижения', onClick: () => {
        if (!suppressClick.current && !leaving) onOpen(group.leading);
        suppressClick.current = false;
      }, onPointerDown: event => {
      if (leaving || event.button !== 0 || start.current) return;
      suppressClick.current = false;
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      banner.current?.setAttribute('data-arrived', '');
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }, onPointerMove: event => {
      const point = start.current;
      if (!point || point.id !== event.pointerId || !animated()) return;
      const x = Math.min(0, event.clientX - point.x);
      const y = Math.min(0, event.clientY - point.y);
      banner.current?.style.setProperty('--notice-x', `${x}px`);
      banner.current?.style.setProperty('--notice-y', `${y}px`);
    }, onPointerUp: event => finishDrag(event), onPointerCancel: event => finishDrag(event, true),
      onLostPointerCapture: event => finishDrag(event, true) }} />
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

function AchievementMomentDetails({ groups, initial, onOpen }: { groups: readonly AchievementGroup[]; initial: number; onOpen: (grant: AchievementGrant) => void }) {
  const [page, setPage] = useState(initial);
  const [direction, setDirection] = useState<'next' | 'previous'>();
  const start = useRef<{ x: number; y: number } | null>(null);
  function goTo(index: number) {
    if (!groups[index] || index === page) return;
    setDirection(index > page ? 'next' : 'previous');
    setPage(index);
  }
  const group = groups[page] ?? groups[0];
  if (!group) return null;
  const total = groups.reduce((sum, group) => sum + 1 + group.additional.length, 0);
  return <div className="achievement-moment-details">
    <div className="achievement-moment-meta"><span>Получено наград · {total}</span>
      {groups.length > 1 && <span aria-live="polite">{page + 1} из {groups.length}</span>}
    </div>
    <div className="achievement-pages" onTouchStart={event => {
      const touch = event.touches.length === 1 ? event.touches[0] : null;
      start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    }} onTouchCancel={() => { start.current = null; }} onTouchEnd={event => {
      const point = start.current, touch = event.changedTouches[0];
      start.current = null;
      if (!point || !touch) return;
      const delta = point.x - touch.clientX;
      if (Math.abs(delta) > Math.max(40, Math.abs(point.y - touch.clientY) * 1.4)) goTo(page + (delta > 0 ? 1 : -1));
    }}>
      <section className="achievement-page" key={group.key} data-direction={direction}>
        <h3>{groupTitle(group.leading)}</h3>
        <AchievementStack group={group} onOpen={onOpen} />
      </section>
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
  const [selected, setSelected] = useState<AchievementGrant | null>(null);
  const waiting = groups.filter(group => !seen.includes(group.key) && groupGrants(group).some(grant => !grant.notifiedAt));
  const current = waiting[0];
  if (reading) return <BottomSheet title="Полученные достижения" onClose={onNext}>
    <AchievementMomentDetails groups={groups} initial={Math.max(0, groups.findIndex(group => group.key === reading))} onOpen={setSelected} />
    {selected && <AchievementGrantDetails grant={selected} onClose={() => setSelected(null)} />}
  </BottomSheet>;
  if (!current) return null;
  return <AchievementBanner key={current.key} group={current} compact={compact} onShown={() => onShown(groupGrants(current))}
    onNext={() => waiting.length > 1 ? setSeen(keys => [...keys, current.key]) : onNext()}
    onOpen={grant => {
      setReading(current.key);
      if (grant !== current.leading) setSelected(grant);
      onShown(groups.flatMap(groupGrants));
    }} />;
}

export function SessionAchievements({ grants }: { grants: readonly AchievementGrant[] }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<AchievementGrant | null>(null);
  const groups = groupAchievementGrants(grants);
  if (!groups.length) return null;
  const earned = groups.reduce((total, group) => total + 1 + group.additional.length, 0);
  return <span className="session-achievements-action" data-testid="session-achievements">
    <button type="button" aria-haspopup="dialog" onClick={() => setExpanded(true)}>
      <Icon name="trophy" /><span className="sr-only">Получено достижений: </span><strong>{earned}</strong>
    </button>
    {expanded && <BottomSheet title="Достижения тренировки" onClose={() => setExpanded(false)}>
      <div className="achievement-session-stacks">{groups.map(group => <AchievementStack key={group.key} group={group} onOpen={setSelected} />)}</div>
      {selected && <AchievementGrantDetails grant={selected} onClose={() => setSelected(null)} />}
    </BottomSheet>}
  </span>;
}
