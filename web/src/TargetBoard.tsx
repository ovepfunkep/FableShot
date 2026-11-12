import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { DEFAULT_TARGET, getTargetProfile, isOnTargetInput, markTargetPoint, MISS_RING_WIDTH, outerRadius, scorePoint, shaftRadius } from './target.ts';
import type { Point, Shot, TargetSpec } from './target.ts';

type Size = { width: number; height: number };
type View = { zoom: number; x: number; y: number };
type ZoomScope = 'training' | 'editor';
type Aim = { point: Point; screen: Point; radius: number };
type Gesture = { pointers: Map<number, Point>; aimId: number | null; multi: boolean; timer: number | null;
  blocked: { id: number; origin: Point } | null };

const initialView: View = { zoom: 1, x: 0, y: 0 };
const ringColors = ['#f6f5e9', '#242a2c', '#3295c7', '#e44c43', '#f4ce44'];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const radiusOf = (size: Size) => Math.max(1, Math.min(size.width, size.height) * .44);

const zoomKey = (scope: ZoomScope) => `app.fableshot.target-zoom.${scope}.v1`;

function initialTargetView(scope?: ZoomScope): View {
  if (scope) {
    try {
      const zoom = Number(window.localStorage.getItem(zoomKey(scope)));
      if (Number.isFinite(zoom) && zoom >= 1 && zoom <= 8) return { ...initialView, zoom };
    } catch { /* The target remains usable without local storage. */ }
  }
  return initialView;
}

export function zoneColor(points: number): string {
  return points > 0 ? ringColors[Math.floor((points - 1) / 2)] : '#667267';
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
    if (ctx) paintFace(ctx, { x: 24, y: 24 }, 22, {
      profileId, diameterMm: profile.diameters[0] ?? 400, shaftDiameterMm: 6,
    });
  }, [profileId]);
  return <canvas ref={canvas} className="target-preview" aria-hidden="true" />;
}

function Lens({ aim, spec }: { aim: Aim; spec: TargetSpec }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hit = scorePoint(aim.point, spec);
  const scale = Number(document.documentElement.style.getPropertyValue('--app-scale')) || 1;
  useLayoutEffect(() => {
    const ctx = canvas.current && canvasContext(canvas.current, 124, 112);
    if (!ctx) return;
    const radius = aim.radius * 2.5 / scale;
    paintFace(ctx, { x: 62 - aim.point.x * radius, y: 56 - aim.point.y * radius }, radius, spec, true);
    circle(ctx, 62, 56, radius * shaftRadius(spec));
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#152016';
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }, [aim, scale, spec]);
  const left = clamp(aim.screen.x / scale - 62, 8, Math.max(8, window.innerWidth / scale - 132));
  const top = Math.max(8, aim.screen.y / scale - 176);
  const color = zoneColor(hit.points);
  const foreground = hit.points >= 3 && hit.points <= 4 ? '#fff' : '#101510';
  const inner = hit.code === 'X' || hit.points > 0 && hit.points % 2 === 0;
  return <div className="lens" data-testid="lens" aria-hidden="true" style={{ left, top }}>
    <div className="lens-score" style={inner ? undefined : { backgroundColor: color }}>
      <strong style={{ backgroundColor: inner ? color : '#f2f6ee', color: inner ? foreground : '#101510' }}>{hit.code}</strong>
    </div>
    <canvas ref={canvas} className="lens-canvas" />
  </div>;
}

export function TargetBoard({ shots, inputEnabled, onShot, selectedIndex, navigation, onBlockedTap, panOnly = false, spec = DEFAULT_TARGET, zoomScope }: {
  shots: readonly Shot[]; inputEnabled: boolean; onShot: (shot: Shot) => void;
  selectedIndex?: number | null; navigation?: ReactNode; onBlockedTap?: () => void;
  spec?: TargetSpec;
  panOnly?: boolean;
  zoomScope?: ZoomScope;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState(() => initialTargetView(zoomScope));
  const viewRef = useRef(view);
  const [aim, setAim] = useState<Aim | null>(null);
  const gesture = useRef<Gesture>({ pointers: new Map(), aimId: null, multi: false, timer: null, blocked: null });

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
    return () => {
      observer.disconnect();
      if (track.timer !== null) window.clearTimeout(track.timer);
    };
  }, []);

  useLayoutEffect(() => {
    if (!size.width || !size.height || !canvas.current) return;
    const ctx = canvasContext(canvas.current, size.width, size.height);
    if (!ctx) return;
    const radius = radiusOf(size) * view.zoom;
    const center = { x: size.width / 2 + view.x, y: size.height / 2 + view.y };
    paintFace(ctx, center, radius, spec, true);
    function paintShot(shot: Shot, index: number, selected: boolean) {
      const position = shot.point ?? shot.missPoint;
      if (!position || !ctx) return;
      const x = center.x + position.x * radius;
      const y = center.y + position.y * radius;
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
  }, [size, view, shots, selectedIndex, spec]);

  function changeView(zoom: number, x: number, y: number) {
    const limit = radiusOf(size) * (panOnly ? zoom : zoom - 1);
    const next = { zoom, x: clamp(x, -limit, limit), y: clamp(y, -limit, limit) };
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
    const radius = radiusOf(size) * current.zoom;
    return { x: (point.x - size.width / 2 - current.x) / radius,
      y: (point.y - size.height / 2 - current.y) / radius };
  }

  function clearAim() {
    const track = gesture.current;
    if (track.timer !== null) window.clearTimeout(track.timer);
    track.timer = null;
    track.aimId = null;
    setAim(null);
  }

  function showAim(position: Point) {
    const point = normalized(position);
    const rect = surface.current?.getBoundingClientRect();
    setAim(rect && isOnTargetInput(point, spec)
      ? { point, screen: { x: rect.left + position.x, y: rect.top + position.y }, radius: radiusOf(size) * viewRef.current.zoom } : null);
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
      clearAim();
      return;
    }
    track.multi = false;
    track.blocked = null;
    if (!isOnTargetInput(normalized(position), spec)) return;
    if (!inputEnabled || panOnly) {
      if (onBlockedTap) track.blocked = { id: event.pointerId, origin: position };
      return;
    }
    track.aimId = event.pointerId;
    track.timer = window.setTimeout(() => {
      track.timer = null;
      const current = track.pointers.get(event.pointerId);
      if (current && !track.multi) showAim(current);
    }, 115);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const track = gesture.current;
    const previous = track.pointers.get(event.pointerId);
    if (!previous) return;
    const position = local(event);
    if (track.blocked && distance(position, track.blocked.origin) > 8) track.blocked = null;
    const before = [...track.pointers.values()];
    track.pointers.set(event.pointerId, position);
    const current = viewRef.current;
    if (before.length >= 2) {
      const after = [...track.pointers.values()];
      const from = midpoint(before[0], before[1]);
      const to = midpoint(after[0], after[1]);
      const zoom = clamp(current.zoom * distance(after[0], after[1]) / Math.max(1, distance(before[0], before[1])), 1, 8);
      const ratio = zoom / current.zoom;
      changeView(zoom, to.x - size.width / 2 - (from.x - size.width / 2 - current.x) * ratio,
        to.y - size.height / 2 - (from.y - size.height / 2 - current.y) * ratio);
    } else if (!track.multi && track.aimId === event.pointerId) {
      if (track.timer === null) showAim(position);
    } else if (!track.multi && (panOnly || current.zoom > 1)) {
      changeView(current.zoom, current.x + position.x - previous.x, current.y + position.y - previous.y);
    }
  }

  function end(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    const track = gesture.current;
    if (!track.pointers.has(event.pointerId)) return;
    const shouldScore = commit && inputEnabled && !track.multi && track.aimId === event.pointerId;
    const point = normalized(local(event));
    const shouldSuggest = commit && !inputEnabled && !track.multi && track.blocked?.id === event.pointerId
      && distance(local(event), track.blocked.origin) <= 8 && isOnTargetInput(point, spec);
    track.pointers.delete(event.pointerId);
    if (track.pointers.size === 0) {
      if (track.multi) rememberZoom();
      clearAim();
      track.multi = false;
      track.blocked = null;
    }
    if (shouldScore) {
      const shot = markTargetPoint(point, spec);
      if (shot) onShot(shot);
    } else if (shouldSuggest) onBlockedTap?.();
  }

  function zoomBy(factor: number) {
    const current = viewRef.current;
    const zoom = clamp(current.zoom * factor, 1, 8);
    changeView(zoom, current.x * zoom / current.zoom, current.y * zoom / current.zoom);
    rememberZoom();
  }

  return <section className="target-stage" aria-label="Отметка попаданий">
    <div ref={surface} className="target-surface" data-testid="target" data-target-profile={spec.profileId}
      onPointerDown={start} onPointerMove={move} onPointerUp={event => end(event, true)}
      onPointerCancel={event => end(event, false)} onLostPointerCapture={event => end(event, false)}>
      <canvas ref={canvas} role="img" aria-label="Мишень для отметки попаданий" />
    </div>
    <div className="zoom" role="group" aria-label="Приближение мишени">
      <button type="button" aria-label="Уменьшить" onClick={() => zoomBy(1 / 1.5)} disabled={view.zoom <= 1}>−</button>
      <button type="button" className="zoom-value" aria-label="Сбросить приближение" onClick={() => { changeView(1, 0, 0); rememberZoom(); }}>
        {view.zoom.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×
      </button>
      <button type="button" aria-label="Увеличить" onClick={() => zoomBy(1.5)} disabled={view.zoom >= 8}>+</button>
    </div>
    {navigation}
    {aim && <Lens aim={aim} spec={spec} />}
  </section>;
}
