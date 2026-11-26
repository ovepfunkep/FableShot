import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import './conditions.css';

function canStartDrag(target: EventTarget | null, panel: HTMLDialogElement) {
  if (!(target instanceof Element) || target === panel || target.closest('input, textarea, select, [contenteditable], [data-sheet-gesture="ignore"], [role="slider"]')) return false;
  if (target.closest('dialog') !== panel) return false;
  for (let element: Element | null = target; element; element = element.parentElement) {
    if (element.scrollTop > 1 && (element === panel || /auto|scroll/.test(getComputedStyle(element).overflowY))) return false;
    if (element === panel) return true;
  }
  return false;
}

function paintDrag(panel: HTMLDialogElement, distance: number, height: number) {
  const shift = Math.min(height, Math.max(0, distance));
  panel.dataset.sheetDragging = '';
  panel.style.setProperty('--sheet-shift', `${shift}px`);
  panel.style.setProperty('--sheet-scrim-opacity', String(1 - shift / height));
}

function clearDrag(panel: HTMLDialogElement) {
  delete panel.dataset.sheetDragging;
  panel.style.removeProperty('--sheet-shift');
  panel.style.removeProperty('--sheet-scrim-opacity');
}

export function useSheetTouchDismiss(dialog: RefObject<HTMLDialogElement | null>, onDismiss: () => void) {
  const dismiss = useEffectEvent(onDismiss);
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    let gesture: { id: number; x: number; y: number; height: number; claimed: boolean } | undefined;
    let suppressClickUntil = 0;
    function start(event: TouchEvent) {
      suppressClickUntil = 0;
      gesture = undefined;
      if (event.touches.length !== 1 || !canStartDrag(event.target, panel!)) {
        if (panel!.hasAttribute('data-sheet-dragging')) clearDrag(panel!);
        return;
      }
      const touch = event.touches[0];
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, height: panel!.offsetHeight, claimed: false };
    }
    function move(event: TouchEvent) {
      if (!gesture || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.identifier !== gesture.id) return;
      const distance = touch.clientY - gesture.y;
      const sideways = Math.abs(touch.clientX - gesture.x);
      if (!gesture.claimed) {
        if ((sideways >= 8 && sideways >= Math.abs(distance)) || distance <= -8 || !event.cancelable) { gesture = undefined; return; }
        if (distance < 8) return;
        gesture.claimed = true;
      }
      event.preventDefault();
      paintDrag(panel!, distance, gesture.height);
    }
    function end(event: TouchEvent) {
      const current = gesture;
      gesture = undefined;
      if (!current?.claimed) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === current.id);
      suppressClickUntil = performance.now() + 400;
      clearDrag(panel!);
      if (event.type !== 'touchcancel' && touch && touch.clientY - current.y >= 65) dismiss();
    }
    function click(event: MouseEvent) {
      if (!panel!.hasAttribute('data-sheet-closing') && (event.detail === 0 || performance.now() >= suppressClickUntil)) return;
      event.preventDefault();
      event.stopPropagation();
    }
    panel.addEventListener('touchstart', start, { passive: true });
    panel.addEventListener('touchmove', move, { passive: false });
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);
    panel.addEventListener('click', click, true);
    return () => {
      panel.removeEventListener('touchstart', start);
      panel.removeEventListener('touchmove', move);
      panel.removeEventListener('touchend', end);
      panel.removeEventListener('touchcancel', end);
      panel.removeEventListener('click', click, true);
    };
  }, [dialog]);
}

export function useSheetDismiss(dialog: RefObject<HTMLDialogElement | null>, onClose: () => void, allow?: () => boolean) {
  const close = useRef(onClose);
  const closeTimer = useRef<number | undefined>(undefined);
  useLayoutEffect(() => { close.current = onClose; }, [onClose]);
  useLayoutEffect(() => () => window.clearTimeout(closeTimer.current), []);
  return function dismiss() {
    const panel = dialog.current;
    if (!panel?.open || panel.hasAttribute('data-sheet-closing') || (allow && !allow())) return;
    if (document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      close.current();
      return;
    }
    panel.dataset.sheetClosing = '';
    closeTimer.current = window.setTimeout(() => {
      delete panel.dataset.sheetClosing;
      close.current();
    }, 205);
  };
}

export function BottomSheet({ title, onClose, children, tag, headerAction, headerLeading, startAtTop, onDismissRequest, className }: {
  title: string; onClose: () => void; children: ReactNode; tag?: string; headerAction?: ReactNode; startAtTop?: boolean;
  onDismissRequest?: () => boolean;
  className?: string;
  headerLeading?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; height: number } | null>(null);
  const backdropPress = useRef(false);
  const dismiss = useSheetDismiss(dialog, onClose, onDismissRequest);
  useSheetTouchDismiss(dialog, dismiss);
  useLayoutEffect(() => {
    dialog.current?.showModal();
  }, []);
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!startAtTop || !panel) return;
    panel.focus({ preventScroll: true });
    panel.scrollTop = 0;
  }, [startAtTop]);

  function resetDrag(panel: HTMLDialogElement) {
    drag.current = null;
    clearDrag(panel);
  }

  return <dialog ref={dialog} className={className ? `condition-sheet ${className}` : 'condition-sheet'} aria-label={title} data-testid={tag} tabIndex={startAtTop ? -1 : undefined}
    onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); event.stopPropagation(); dismiss(); }}
    onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }}
    onClick={event => {
      if (backdropPress.current && event.target === event.currentTarget) dismiss();
      backdropPress.current = false;
    }}>
    <div className="condition-sheet-body">
      <header onPointerDown={event => {
        const panel = dialog.current;
        if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0 || !panel || panel.hasAttribute('data-sheet-closing') ||
          event.target instanceof Element && event.target.closest('button, a, input, select')) return;
        drag.current = { pointerId: event.pointerId, startY: event.clientY, height: panel.offsetHeight };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
        onPointerMove={event => {
          const panel = dialog.current, current = drag.current;
          if (!panel || current?.pointerId !== event.pointerId) return;
          const distance = Math.max(0, event.clientY - current.startY);
          if (distance === 0 && !panel.hasAttribute('data-sheet-dragging')) return;
          paintDrag(panel, distance, current.height);
        }}
        onPointerUp={event => {
          const panel = dialog.current, current = drag.current;
          if (!panel || current?.pointerId !== event.pointerId) return;
          const close = event.clientY - current.startY > 65;
          resetDrag(panel);
          if (close) dismiss();
        }}
        onLostPointerCapture={event => {
          const panel = dialog.current;
          if (panel && drag.current?.pointerId === event.pointerId) resetDrag(panel);
        }}>
        <span className="sheet-handle" aria-hidden="true" />
        {headerAction || headerLeading ? <div className="sheet-title-actions">{headerLeading ?? <h2>{title}</h2>}{headerAction}</div> : <h2>{title}</h2>}
      </header>
      {children}
    </div>
  </dialog>;
}
