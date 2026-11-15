import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Point } from './target.ts';

export const MAX_TARGET_ZOOM = 8;
export const TARGET_ZOOM_STEP = 1.5;
const positionKey = 'app.fableshot.target-zoom-position.v1';

type ZoomControls = {
  zoom: number;
  onStep: (factor: number) => void;
  onReset: () => void;
};

type ZoomDrag = {
  id: number;
  start: Point;
  offset: Point;
  moved: boolean;
};

export function clampTargetZoom(zoom: number): number {
  return Math.max(1, Math.min(MAX_TARGET_ZOOM, zoom));
}

function ZoomButtons({ zoom, onStep, onReset }: ZoomControls) {
  return <>
    <button type="button" aria-label="Уменьшить" onClick={() => onStep(1 / TARGET_ZOOM_STEP)} disabled={zoom <= 1}>−</button>
    <button type="button" className="zoom-value" aria-label="Сбросить приближение" onClick={onReset}>
      {zoom.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×
    </button>
    <button type="button" aria-label="Увеличить" onClick={() => onStep(TARGET_ZOOM_STEP)} disabled={zoom >= MAX_TARGET_ZOOM}>+</button>
  </>;
}

export function TargetZoom({ className = 'zoom', ...controls }: ZoomControls & { className?: string }) {
  return <div className={className} role="group" aria-label="Приближение мишени">
    <ZoomButtons {...controls} />
  </div>;
}

function readPosition(): Point | null {
  try {
    const point = JSON.parse(window.localStorage.getItem(positionKey) ?? 'null') as Point | null;
    if (point && [point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return point;
  } catch { /* The panel starts in its usual position if the saved position is unreadable. */ }
  return null;
}

const positionFraction = (offset: number, travel: number) => travel > 0
  ? Math.min(1, Math.max(0, offset / travel)) : 0;

export function MovableTargetZoom(controls: ZoomControls) {
  const [savedPosition, setSavedPosition] = useState(readPosition);
  const [dragPosition, setDragPosition] = useState<Point | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<ZoomDrag | null>(null);
  const position = dragPosition ?? savedPosition;

  function positionAt(left: number, top: number): Point {
    const limits = viewport.current!.getBoundingClientRect();
    const size = panel.current!.getBoundingClientRect();
    return {
      x: positionFraction(left - limits.left, limits.width - size.width),
      y: positionFraction(top - limits.top, limits.height - size.height),
    };
  }

  function savePosition(point: Point) {
    setSavedPosition(point);
    try { window.localStorage.setItem(positionKey, JSON.stringify(point)); }
    catch { /* Keep the new position on screen when storage is unavailable. */ }
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    const start = { x: event.clientX, y: event.clientY };
    const { left, top } = panel.current!.getBoundingClientRect();
    drag.current = { id: event.pointerId, start, offset: { x: start.x - left, y: start.y - top }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragPoint(event: PointerEvent<HTMLButtonElement>): Point | null {
    const current = drag.current;
    if (current?.id !== event.pointerId) return null;
    if (!current.moved && Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < 4) return null;
    current.moved = true;
    return positionAt(event.clientX - current.offset.x, event.clientY - current.offset.y);
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    const point = dragPoint(event);
    if (point) savePosition(point);
    cancelDrag(event);
  }

  function cancelDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragPosition(null);
  }

  function moveByKey(event: KeyboardEvent<HTMLButtonElement>) {
    const step = 16;
    const { left, top } = panel.current!.getBoundingClientRect();
    switch (event.key) {
      case 'ArrowLeft': savePosition(positionAt(left - step, top)); break;
      case 'ArrowRight': savePosition(positionAt(left + step, top)); break;
      case 'ArrowUp': savePosition(positionAt(left, top - step)); break;
      case 'ArrowDown': savePosition(positionAt(left, top + step)); break;
      default: return;
    }
    event.preventDefault();
  }

  // Store fractions of the available travel so the whole panel fits after a resize.
  const placement = position ? {
    left: `${position.x * 100}%`,
    top: `${position.y * 100}%`,
    transform: `translate(${-position.x * 100}%, ${-position.y * 100}%)`,
  } : undefined;

  return <>
    <div ref={viewport} className="zoom-move-limits" aria-hidden="true" />
    <div className={position ? 'zoom-move-layer' : undefined}>
      <div ref={panel} className="zoom zoom-movable" style={placement} role="group" aria-label="Приближение мишени">
        <button type="button" className="zoom-handle" aria-label="Переместить панель масштаба"
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" title="Перетащить панель масштаба"
          onKeyDown={moveByKey} onPointerDown={startDrag}
          onPointerMove={event => { const point = dragPoint(event); if (point) setDragPosition(point); }}
          onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
          <span aria-hidden="true">⠿</span>
        </button>
        <ZoomButtons {...controls} />
      </div>
    </div>
  </>;
}
