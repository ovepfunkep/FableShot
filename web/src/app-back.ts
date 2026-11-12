import { Capacitor } from '@capacitor/core';
import { useLayoutEffect, useRef } from 'react';

const guardKey = 'fableshotBack';
type BackWindow = Window & { fableShotBack?: () => boolean };

function topDialog(): HTMLDialogElement | undefined {
  return document.activeElement?.closest<HTMLDialogElement>('dialog:modal') ??
    Array.from(document.querySelectorAll<HTMLDialogElement>('dialog:modal')).at(-1);
}

function cancelDialog(dialog: HTMLDialogElement) {
  // Existing onCancel handlers own the current step, including editors inside one dialog.
  if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
}

export function useAppBack(canGoBack: boolean, onBack: () => void) {
  const current = useRef({ canGoBack, onBack });
  useLayoutEffect(() => { current.current = { canGoBack, onBack }; });

  useLayoutEffect(() => {
    const host = window as BackWindow;
    const native = Capacitor.getPlatform() === 'android';
    let armed = !native && window.history.state?.[guardKey] === true;

    function goBack(): boolean {
      const dialog = topDialog();
      if (dialog) cancelDialog(dialog);
      else if (current.current.canGoBack) current.current.onBack();
      else return false;
      return true;
    }

    function arm() {
      if (native || armed || (!current.current.canGoBack && !topDialog())) return;
      window.history.pushState({ ...window.history.state, [guardKey]: true }, '');
      armed = true;
    }

    function pop() {
      if (window.history.state?.[guardKey] === true) { armed = true; return; }
      if (!armed) return;
      armed = false;
      if (goBack()) arm();
      else window.history.back();
    }

    function escape(event: KeyboardEvent) {
      // The browser sends a real cancel event to the top modal on Escape.
      if (event.key === 'Escape' && !event.defaultPrevented && !topDialog() && current.current.canGoBack) {
        event.preventDefault();
        current.current.onBack();
      }
    }

    host.fableShotBack = goBack;
    window.addEventListener('keydown', escape);
    if (!native) window.addEventListener('popstate', pop);
    const observer = !native ? new MutationObserver(arm) : undefined;
    observer?.observe(document.getElementById('root')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    arm();
    return () => {
      delete host.fableShotBack;
      window.removeEventListener('keydown', escape);
      window.removeEventListener('popstate', pop);
      observer?.disconnect();
    };
  }, []);
}
