import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_TARGET, getTargetProfile, isOnTargetInput, markTargetPoint, MISS_RING_WIDTH, outerRadius, scorePoint, shaftRadius, spotOffsets, spotPoint, targetInput, zoneColor } from './target.ts';
import type { Point, Shot, TargetSpec, TargetSpot } from './target.ts';
import { clampTargetZoom, MAX_TARGET_ZOOM, MovableTargetZoom, TargetZoom } from './TargetZoom.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { AIM_SPEED_SETTING, DEFAULT_SHOT_MOTION_STYLE, LENS_ZOOM_SETTING } from './preferences.ts';
import type { ShotMotionEvent } from './ShotMotion.tsx';

type Size = { width: number; height: number };
type View = { zoom: number; x: number; y: number };
type ZoomScope = 'training' | 'editor';
type Aim = { point: Point; spot?: TargetSpot; screen: Point };
type AimAnchor = { position: Point; point: Point; screen: Point; steadiness?: { origin: Point; shown: Point; since: number; locked: boolean } };
type Gesture = { pointers: Map<number, Point>; multi: boolean; timer: number | null;
  aim: { id: number; origin: Point; startsOnFace: boolean; anchor: AimAnchor | null } | null;
  touchTap: { id: number; origin: Point; startedAt: number } | null;
  pan: { id: number; origin: Point; firstTap: (() => void) | null } | null;
  blocked: { id: number; origin: Point } | null };

const initialView: View = { zoom: 1, x: 0, y: 0 };
const AIM_SPEED = 1.92;
const TAP_SLOP = 8;
const DOUBLE_TAP_MS = 240;
const DOUBLE_TAP_DISTANCE = 32;
const LENS_WIDTH = 264;
const LENS_HEIGHT = 236;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const radiusOf = (size: Size) => Math.max(1, Math.min(size.width, size.height) * .44);

const zoomKey = (scope: ZoomScope) => `app.fableshot.target-zoom.${scope}.v1`;

function initialTargetView(scope?: ZoomScope): View {
  if (scope) {
    try {
      const zoom = Number(window.localStorage.getItem(zoomKey(scope)));
      if (Number.isFinite(zoom) && zoom >= 1 && zoom <= MAX_TARGET_ZOOM) return { ...initialView, zoom };
    } catch { /* The target remains usable without local storage. */ }
  }
  return initialView;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

function paintFace(ctx: CanvasRenderingContext2D, center: Point, radius: number, spec: TargetSpec, showMissRing = false) {
  const profile = getTargetProfile(spec.profileId)!;
  if (showMissRing) {
    circle(ctx, center.x, center.y, radius * (outerRadius(spec) + MISS_RING_WIDTH));
    ctx.fillStyle = '#536052';
    ctx.fill();
    ctx.strokeStyle = '#758175';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  for (const zone of [...profile.zones].reverse()) {
    circle(ctx, center.x, center.y, radius * zone.outerRadius);
    ctx.fillStyle = zoneColor(zone.points);
    ctx.fill();
    ctx.strokeStyle = '#30352c';
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }
}

function paintSeries(ctx: CanvasRenderingContext2D, center: Point, radius: number, spec: TargetSpec,
  shots: readonly Shot[], selectedIndex?: number | null, realArrowDiameter = spec.shaftDiameterMm) {
  const profile = getTargetProfile(spec.profileId)!;
  for (const offset of spotOffsets(profile)) paintFace(ctx, { x: center.x, y: center.y + offset * radius }, radius, spec, true);

  function paintShot(shot: Shot, index: number, selected: boolean) {
    const local = shot.point ?? shot.missPoint;
    if (!local) return;
    const position = spotPoint(local, shot.spot);
    const x = center.x + position.x * radius;
    const y = center.y + position.y * radius;
    if (realArrowDiameter && !shot.missPoint) {
      const footprint = radius * realArrowDiameter / spec.diameterMm;
      if (selected) {
        circle(ctx, x, y, Math.max(8, footprint + 3));
        ctx.strokeStyle = '#c6f43d';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      circle(ctx, x, y, footprint);
      ctx.fillStyle = '#14200d';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.min(1, footprint / 2);
      ctx.stroke();
      return;
    }
    if (selected) {
      circle(ctx, x, y, 13);
      ctx.fillStyle = '#101510';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    circle(ctx, x, y, 9);
    ctx.fillStyle = shot.missPoint ? '#536052' : '#14200d';
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? '#c6f43d' : '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), x, y);
  }
  shots.forEach((shot, index) => { if (index !== selectedIndex) paintShot(shot, index, false); });
  if (selectedIndex != null && shots[selectedIndex]) paintShot(shots[selectedIndex], selectedIndex, true);
}

function canvasContext(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx?.clearRect(0, 0, width, height);
  return ctx;
}

export function TargetPreview({ profileId }: { profileId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const profile = getTargetProfile(profileId)!;
    const ctx = canvas.current && canvasContext(canvas.current, 48, 48);
    if (ctx) for (const offset of spotOffsets(profile)) paintFace(ctx, { x: 24, y: 24 + offset * (profile.vertical ? 13 : 22) }, profile.vertical ? 13 : 22, {
      profileId, diameterMm: profile.diameters[0] ?? 400, shaftDiameterMm: 6,
    });
  }, [profileId]);
  return <canvas ref={canvas} className="target-preview" aria-hidden="true" />;
}

function Lens({ aim, baseRadius, spec, shots, selectedIndex, realArrowDiameter }: {
  aim: Aim; baseRadius: number; spec: TargetSpec; shots: readonly Shot[];
  selectedIndex?: number | null; realArrowDiameter?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hit = isOnTargetInput(aim.point, spec) ? scorePoint(aim.point, spec) : { code: '—', points: 0 };
  const { preferences } = useTrainingPreferences();
  const scale = Number(document.documentElement.style.getPropertyValue('--app-scale')) || 1;
  const fit = Math.max(.1, Math.min(1, (window.innerWidth / scale - 18) / LENS_WIDTH,
    (window.innerHeight / scale - 54) / LENS_HEIGHT));
  const width = LENS_WIDTH * fit;
  const height = LENS_HEIGHT * fit;
  const radius = baseRadius * (preferences.lensZoomPercent ?? LENS_ZOOM_SETTING.default) / 100 / scale;
  const shaft = radius * shaftRadius(spec);
  useLayoutEffect(() => {
    const ctx = canvas.current && canvasContext(canvas.current, width, height);
    if (!ctx) return;
    const point = spotPoint(aim.point, aim.spot);
    const center = { x: width / 2 - point.x * radius, y: height / 2 - point.y * radius };
    paintSeries(ctx, center, radius, spec, shots, selectedIndex, realArrowDiameter);
    circle(ctx, width / 2, height / 2, shaft);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#152016';
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }, [aim, radius, shaft, spec, shots, selectedIndex, realArrowDiameter, width, height]);
  const left = clamp(aim.screen.x / scale - width / 2 - 1, 8, Math.max(8, window.innerWidth / scale - width - 10));
  const top = Math.max(8, aim.screen.y / scale - height - 28);
  const zone = zoneColor(hit.points);
  const color = hit.points <= 4 ? '#edf5ed' : hit.points <= 6 ? '#76d2ff' : hit.points <= 8 ? '#ff8d7d' : zone;
  const scoreStyle = { '--lens-zone': zone, color, fontSize: width * .125 } as CSSProperties;
  return <div className="lens" data-testid="lens" aria-hidden="true" style={{ left, top, width: width + 2 }}>
    <canvas ref={canvas} className="lens-canvas" style={{ height }} />
    <div className="lens-score" style={scoreStyle}><strong>{hit.code}</strong></div>
  </div>;
}

export function TargetBoard({ shots, inputEnabled, onShot, selectedIndex, onBlockedTap, onOpenLensSettings, panOnly = false, spec = DEFAULT_TARGET, zoomScope, realArrowDiameter, feedback, removed, showZoom = true }: {
  shots: readonly Shot[]; inputEnabled: boolean; onShot: (shot: Shot) => void;
  selectedIndex?: number | null; onBlockedTap?: () => void; onOpenLensSettings?: () => void;
  spec?: TargetSpec;
  panOnly?: boolean;
  zoomScope?: ZoomScope;
  realArrowDiameter?: number;
  feedback?: ShotMotionEvent;
  removed?: { id: number; shot: Shot };
  showZoom?: boolean;
}) {
  const { preferences } = useTrainingPreferences();
  const aimSpeed = AIM_SPEED * (preferences.aimSpeedPercent ?? AIM_SPEED_SETTING.default) / 100;
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState(() => initialTargetView(zoomScope));
  const viewRef = useRef(view);
  const movedManually = useRef(false);
  const [aim, setAim] = useState<Aim | null>(null);
  const gesture = useRef<Gesture>({ pointers: new Map(), aim: null, multi: false, timer: null,
    touchTap: null, pan: null, blocked: null });
  const pendingTap = useRef<{ timer: number; origin: Point; deliver: () => void } | null>(null);
  const actions = useRef({ inputEnabled, panOnly, onShot, onBlockedTap });
  useLayoutEffect(() => { actions.current = { inputEnabled, panOnly, onShot, onBlockedTap }; });
  const profile = getTargetProfile(spec.profileId)!;
  const baseRadius = profile.vertical ? Math.max(1, Math.min(size.width / 1.32, size.height / 3.8)) : radiusOf(size);

  useLayoutEffect(() => {
    const element = surface.current!;
    function measure() {
      const { width, height } = element.getBoundingClientRect();
      setSize({ width, height });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    const track = gesture.current;
    function finishTapOutsideTarget(event: PointerEvent) {
      const tap = pendingTap.current;
      if (!tap || event.composedPath().includes(element)) return;
      window.clearTimeout(tap.timer);
      pendingTap.current = null;
      tap.deliver();
    }
    document.addEventListener('pointerdown', finishTapOutsideTarget, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', finishTapOutsideTarget, true);
      if (track.timer !== null) window.clearTimeout(track.timer);
      if (pendingTap.current) window.clearTimeout(pendingTap.current.timer);
      pendingTap.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!size.width || !size.height || !canvas.current) return;
    const ctx = canvasContext(canvas.current, size.width, size.height);
    if (!ctx) return;
    const radius = baseRadius * view.zoom;
    const center = { x: size.width / 2 + view.x, y: size.height / 2 + view.y };
    paintSeries(ctx, center, radius, spec, shots, selectedIndex, realArrowDiameter);
  }, [size, view, shots, selectedIndex, spec, realArrowDiameter, baseRadius]);

  function changeView(zoom: number, x: number, y: number) {
    const limit = baseRadius * (panOnly || movedManually.current ? zoom : zoom - 1);
    const verticalLimit = limit * (profile.vertical ? 1.8 : 1);
    const next = { zoom, x: clamp(x, -limit, limit), y: clamp(y, -verticalLimit, verticalLimit) };
    viewRef.current = next;
    setView(next);
  }

  function rememberZoom() {
    if (!zoomScope) return;
    try { window.localStorage.setItem(zoomKey(zoomScope), String(viewRef.current.zoom)); }
    catch { /* Continue with the in-memory zoom when storage is unavailable. */ }
  }

  function local(event: ReactPointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function normalized(point: Point): Point {
    const current = viewRef.current;
    const radius = baseRadius * current.zoom;
    return { x: (point.x - size.width / 2 - current.x) / radius,
      y: (point.y - size.height / 2 - current.y) / radius };
  }

  function aimedPoint(position: Point, anchor: AimAnchor): Point {
    const outer = outerRadius(spec) + MISS_RING_WIDTH;
    const verticalOuter = outer + spotOffsets(profile).at(-1)!;
    function steer(delta: number, from: number, limit: number, finger: number, screenSize: number) {
      const towardsEnd = delta > 0;
      const distanceToEdge = towardsEnd ? limit - from : from + limit;
      const travel = towardsEnd ? screenSize - finger : finger;
      // Use the unzoomed radius so aiming stays fast at 8×. Near a screen edge,
      // increase gain only in the direction with too little room to reach the target edge.
      const gain = Math.max(aimSpeed / baseRadius, distanceToEdge / Math.max(1, travel - 2));
      return from + delta * gain;
    }
    return {
      x: steer(position.x - anchor.position.x, anchor.point.x, outer, anchor.screen.x, window.innerWidth),
      y: steer(position.y - anchor.position.y, anchor.point.y, verticalOuter, anchor.screen.y, window.innerHeight),
    };
  }

  function clearAim() {
    const track = gesture.current;
    if (track.timer !== null) window.clearTimeout(track.timer);
    track.timer = null;
    track.aim = null;
    setAim(null);
  }

  function showAim(position: Point, anchor: AimAnchor) {
    const { point, spot } = targetInput(aimedPoint(position, anchor), profile);
    const rect = surface.current?.getBoundingClientRect();
    if (rect) setAim({ point, spot, screen: { x: rect.left + position.x, y: rect.top + position.y } });
  }

  function steadyPosition(position: Point, anchor: AimAnchor, touch: boolean): Point {
    if (!touch) return position;
    const now = performance.now();
    const state = anchor.steadiness ??= { origin: position, shown: position, since: now, locked: false };
    const travel = distance(position, state.origin);
    if ((state.locked || now - state.since >= 500) && travel <= 5) {
      state.locked = true;
      return state.shown;
    }
    if (travel > 2) {
      state.origin = position;
      state.since = now;
      state.locked = false;
    }
    state.shown = position;
    return position;
  }

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !size.width) return;
    const track = gesture.current;
    const position = local(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    track.pointers.set(event.pointerId, position);
    if (track.pointers.size > 1) {
      track.multi = true;
      track.blocked = null;
      track.touchTap = null;
      const firstTap = track.pan?.firstTap;
      track.pan = null;
      clearAim();
      firstTap?.();
      return;
    }
    track.multi = false;
    track.blocked = null;
    const first = pendingTap.current;
    if (first) {
      window.clearTimeout(first.timer);
      pendingTap.current = null;
      if (event.pointerType === 'touch' && !panOnly && distance(first.origin, position) <= DOUBLE_TAP_DISTANCE) {
        track.pan = { id: event.pointerId, origin: position, firstTap: first.deliver };
        return;
      }
      first.deliver();
    }
    track.touchTap = event.pointerType === 'touch' && !panOnly
      ? { id: event.pointerId, origin: position, startedAt: event.timeStamp } : null;
    const startsOnFace = isOnTargetInput(targetInput(normalized(position), profile).point, spec);
    if (!inputEnabled || panOnly) {
      if (startsOnFace && onBlockedTap) track.blocked = { id: event.pointerId, origin: position };
      return;
    }
    const id = event.pointerId;
    track.aim = { id, origin: position, startsOnFace, anchor: null };
    track.timer = window.setTimeout(() => {
      track.timer = null;
      const current = track.pointers.get(id);
      const rect = surface.current?.getBoundingClientRect();
      if (!current || !rect || track.multi || track.aim?.id !== id) return;
      track.touchTap = null;
      const anchor = { position: current, point: normalized(current),
        screen: { x: rect.left + current.x, y: rect.top + current.y } };
      track.aim.anchor = anchor;
      showAim(steadyPosition(current, anchor, event.pointerType === 'touch'), anchor);
    }, 115);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const track = gesture.current;
    const previous = track.pointers.get(event.pointerId);
    if (!previous) return;
    const position = local(event);
    if (track.touchTap && distance(position, track.touchTap.origin) > TAP_SLOP) track.touchTap = null;
    if (track.blocked && distance(position, track.blocked.origin) > TAP_SLOP) track.blocked = null;
    const before = [...track.pointers.values()];
    track.pointers.set(event.pointerId, position);
    const current = viewRef.current;
    if (before.length >= 2) {
      const after = [...track.pointers.values()];
      const from = midpoint(before[0], before[1]);
      const to = midpoint(after[0], after[1]);
      const zoom = clampTargetZoom(current.zoom * distance(after[0], after[1]) / Math.max(1, distance(before[0], before[1])));
      const ratio = zoom / current.zoom;
      changeView(zoom, to.x - size.width / 2 - (from.x - size.width / 2 - current.x) * ratio,
        to.y - size.height / 2 - (from.y - size.height / 2 - current.y) * ratio);
    } else if (!track.multi) {
      const pan = track.pan;
      if (pan?.id === event.pointerId) {
        let from = previous;
        if (pan.firstTap) {
          if (distance(position, pan.origin) <= TAP_SLOP) return;
          pan.firstTap = null;
          from = pan.origin;
        }
        movedManually.current = true;
        changeView(current.zoom, current.x + position.x - from.x, current.y + position.y - from.y);
        return;
      }
      let panFrom = previous;
      if (track.aim?.id === event.pointerId) {
        const { anchor, origin, startsOnFace } = track.aim;
        if (anchor) { showAim(steadyPosition(position, anchor, event.pointerType === 'touch'), anchor); return; }
        if (startsOnFace && distance(position, origin) > 0) {
          if (track.timer !== null) window.clearTimeout(track.timer);
          track.timer = null;
          track.touchTap = null;
          const rect = event.currentTarget.getBoundingClientRect();
          const immediateAnchor = { position: origin, point: normalized(origin),
            screen: { x: rect.left + origin.x, y: rect.top + origin.y } };
          track.aim.anchor = immediateAnchor;
          showAim(steadyPosition(position, immediateAnchor, event.pointerType === 'touch'), immediateAnchor);
          return;
        }
        if (distance(position, origin) <= TAP_SLOP) return;
        // A quick drag from outside the face still pans the zoomed view.
        panFrom = origin;
        clearAim();
      }
      if (panOnly || current.zoom > 1) {
        changeView(current.zoom, current.x + position.x - panFrom.x, current.y + position.y - panFrom.y);
      }
    }
  }

  function end(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    const track = gesture.current;
    if (!track.pointers.has(event.pointerId)) return;
    const position = local(event);
    const aiming = track.aim;
    const pan = track.pan?.id === event.pointerId ? track.pan : null;
    const tap = track.touchTap;
    const touchTap = commit && tap?.id === event.pointerId && event.timeStamp - tap.startedAt < DOUBLE_TAP_MS
      && distance(position, tap.origin) <= TAP_SLOP;
    const shouldScore = commit && inputEnabled && !panOnly && !track.multi && aiming?.id === event.pointerId
      && (aiming.startsOnFace || aiming.anchor !== null);
    const anchor = aiming?.anchor;
    const { point, spot } = targetInput(anchor ? aimedPoint(steadyPosition(position, anchor, event.pointerType === 'touch'), anchor) : normalized(position), profile);
    const shouldSuggest = commit && !inputEnabled && !track.multi && track.blocked?.id === event.pointerId
      && distance(position, track.blocked.origin) <= TAP_SLOP && isOnTargetInput(point, spec);
    track.pointers.delete(event.pointerId);
    if (track.pointers.size === 0) {
      if (track.multi) rememberZoom();
      clearAim();
      track.multi = false;
      track.blocked = null;
      track.touchTap = null;
      track.pan = null;
    }
    if (pan) {
      if (!pan.firstTap) return;
      pan.firstTap();
      if (!commit || distance(position, pan.origin) > TAP_SLOP) return;
    }
    const shot = shouldScore || pan ? markTargetPoint(point, spec) : null;
    const deliver = () => {
      const current = actions.current;
      if (shot && current.inputEnabled && !current.panOnly) current.onShot(spot === undefined ? shot : { ...shot, spot });
      else if ((shouldSuggest || pan && isOnTargetInput(point, spec)) && !current.inputEnabled) current.onBlockedTap?.();
    };
    if (touchTap) {
      const timer = window.setTimeout(() => {
        pendingTap.current = null;
        deliver();
      }, DOUBLE_TAP_MS);
      pendingTap.current = { timer, origin: position, deliver };
    } else deliver();
  }

  function zoomBy(factor: number) {
    const current = viewRef.current;
    const zoom = clampTargetZoom(current.zoom * factor);
    changeView(zoom, current.x * zoom / current.zoom, current.y * zoom / current.zoom);
    rememberZoom();
  }

  function resetZoom() {
    movedManually.current = false;
    changeView(1, 0, 0);
    rememberZoom();
  }

  const Zoom = zoomScope ? MovableTargetZoom : TargetZoom;
  const marked = feedback && !feedback.cleanSeries ? shots[feedback.index] : undefined;
  const flash = marked?.point && spotPoint(marked.point, marked.spot);
  const removedPoint = removed?.shot.point ?? removed?.shot.missPoint;
  const ghost = removedPoint && spotPoint(removedPoint, removed?.shot.spot);
  const markerStyle = (point: Point) => ({ left: size.width / 2 + view.x + point.x * baseRadius * view.zoom,
    top: size.height / 2 + view.y + point.y * baseRadius * view.zoom });
  const goldFlash = feedback?.points === 10 && (feedback.firstTen || (preferences.shotMotionStyle ?? DEFAULT_SHOT_MOTION_STYLE) === 'cards');
  return <section className="target-stage" aria-label="Отметка попаданий">
    <div ref={surface} className="target-surface" data-testid="target" data-target-profile={spec.profileId}
      onPointerDown={start} onPointerMove={move} onPointerUp={event => end(event, true)}
      onPointerCancel={event => end(event, false)} onLostPointerCapture={event => end(event, false)}>
      <canvas ref={canvas} role="img" aria-label="Мишень для отметки попаданий" />
      {feedback && flash && <span key={feedback.id} className={goldFlash ? 'target-ten-wave' : 'target-shot-pulse'}
        data-testid={goldFlash ? 'target-ten-wave' : 'target-shot-pulse'} aria-hidden="true"
        style={markerStyle(flash)} />}
      {removed && ghost && <span key={removed.id} className="removed-shot-ghost" aria-hidden="true" style={markerStyle(ghost)} />}
    </div>
    {showZoom && <Zoom zoom={view.zoom} onStep={zoomBy} onReset={resetZoom} {...(zoomScope ? { onOpenLensSettings } : {})} />}
    {aim && inputEnabled && !panOnly && <Lens aim={aim} baseRadius={baseRadius * view.zoom} spec={spec} shots={shots}
      selectedIndex={selectedIndex} realArrowDiameter={realArrowDiameter} />}
  </section>;
}

export function LensTestTarget({ onAchievement }: { onAchievement?: (id: 'APP12' | 'APP14') => void } = {}) {
  const { preferences } = useTrainingPreferences();
  const initial = useRef({ speed: preferences.aimSpeedPercent, zoom: preferences.lensZoomPercent });
  const trail = useRef<number[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  return <section className="lens-settings-preview" aria-label="Тестовая мишень" data-testid="lens-settings-preview">
    <h2>Тестовая мишень</h2>
    <p>Удерживай и веди палец, чтобы проверить лупу. Пробные попадания видны только здесь.</p>
    <TargetBoard shots={shots} inputEnabled showZoom={false} onShot={shot => {
      setShots([shot]);
      if (initial.current.speed !== preferences.aimSpeedPercent || initial.current.zoom !== preferences.lensZoomPercent) onAchievement?.('APP12');
      trail.current = [...trail.current.slice(-2), shot.points];
      if (trail.current.join(',') === '10,9,10') onAchievement?.('APP14');
    }} />
  </section>;
}
