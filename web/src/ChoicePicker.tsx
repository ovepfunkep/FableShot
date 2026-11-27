import { useId, useRef, useState } from 'react';
import { BottomSheet } from './BottomSheet.tsx';
import './choice-picker.css';

export function ChoicePicker({ label, value, options, onChange, disabled, variant = 'solid', placeholder = 'Выбрать', testId }: {
  label: string; value: string; options: readonly { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void; disabled?: boolean; variant?: 'solid' | 'ghost'; placeholder?: string; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const currentValueId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value);
  const first = options.find(option => !option.disabled);
  const focus = selected?.disabled ? first : selected ?? first;
  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return <>
    <button type="button" ref={trigger} className="choice-picker-trigger" data-variant={variant} data-testid={testId} data-choice-value={selected?.value}
      aria-label={label} aria-describedby={currentValueId} aria-haspopup="dialog" aria-expanded={open} disabled={disabled || !first} onClick={() => setOpen(true)}>
      <span id={currentValueId}>{selected?.label ?? placeholder}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <BottomSheet className="choice-picker-sheet" title={label} onClose={close}>
      <div className="choice-picker-options" onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const last = buttons.length - 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? last
          : event.key === 'ArrowDown' ? Math.min(last, index + 1) : Math.max(0, index - 1);
        event.preventDefault();
        buttons[next]?.focus();
      }}>
        {options.map(option => <button type="button" key={option.value} autoFocus={option === focus} aria-pressed={option.value === value} data-choice-value={option.value}
          disabled={option.disabled} onClick={() => { close(); onChange(option.value); }}>
          <span>{option.label}</span>{option.value === value && <span aria-hidden="true">✓</span>}
        </button>)}
      </div>
    </BottomSheet>}
  </>;
}
