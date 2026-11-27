import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';

export function useChartScrub<T extends Element>(select: (x: number) => void, scroll?: (direction: number) => void) {
  const gesture = useRef<{ id: number; x: number; y: number; horizontal: boolean } | null>(null);
  const latest = useRef({ select, scroll });
  latest.current = { select, scroll };
  const frame = useRef<number | undefined>(undefined);
  const edge = useRef({ direction: 0, x: 0 });
  function stopEdge() {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }
  useEffect(() => stopEdge, []);
  function tick() {
    latest.current.scroll?.(edge.current.direction);
    latest.current.select(edge.current.x);
    frame.current = requestAnimationFrame(tick);
  }
  function release(event: PointerEvent<T>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    stopEdge();
  }
  return {
    onPointerDown(event: PointerEvent<T>) {
      if (!event.isPrimary || event.button !== 0) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<T>) {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = Math.abs(event.clientX - current.x), dy = Math.abs(event.clientY - current.y);
      if (!current.horizontal && dx < Math.max(6, dy)) return;
      current.horizontal = true;
      select(event.clientX);
      if (!scroll) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const direction = event.clientX < rect.left + 22 ? -1 : event.clientX > rect.right - 22 ? 1 : 0;
      edge.current = { direction, x: Math.max(rect.left, Math.min(rect.right, event.clientX)) };
      if (!direction) stopEdge();
      else if (frame.current === undefined) frame.current = requestAnimationFrame(tick);
    },
    onPointerUp(event: PointerEvent<T>) {
      const current = gesture.current;
      if (current?.id === event.pointerId && (current.horizontal || Math.abs(event.clientY - current.y) < 8)) select(event.clientX);
      release(event);
    },
    onPointerCancel: release,
    onLostPointerCapture: release,
  };
}
