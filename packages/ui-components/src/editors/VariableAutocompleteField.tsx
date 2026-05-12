// Plain-text input/textarea with `{{` autocomplete for env/context/secret
// variables. Used by URL/header/query rows where Monaco would be overkill
// but the user still wants suggestions.
//
// Keyboard: ArrowUp/Down to move, Enter/Tab to insert, Escape to dismiss.
// Mouse: click a suggestion to insert. Click outside the popup to dismiss.

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react';
import {
  collectVariableSuggestions,
  type ResolutionScope,
  type VariableSuggestion,
} from '@apicircle/core';
import { cn } from '../primitives/cn';

interface BaseProps {
  value: string;
  onChange: (value: string) => void;
  scope: ResolutionScope;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  /** Optional — defaults to one-line input. */
  multiline?: boolean;
  rows?: number;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
}

function getOpenTokenStart(text: string, cursor: number): number {
  const before = text.slice(0, cursor);
  const idx = before.lastIndexOf('{{');
  if (idx === -1) return -1;
  if (before.slice(idx + 2).includes('}}')) return -1;
  return idx;
}

function applySuggestion(
  current: string,
  cursor: number,
  suggestion: VariableSuggestion,
): { nextValue: string; nextCursor: number } {
  const after = current.slice(cursor);
  const start = getOpenTokenStart(current, cursor);
  const replacement = `{{${suggestion.key}}}`;
  if (start === -1) {
    const before = current.slice(0, cursor);
    return {
      nextValue: before + replacement + after,
      nextCursor: before.length + replacement.length,
    };
  }
  return {
    nextValue: current.slice(0, start) + replacement + after,
    nextCursor: start + replacement.length,
  };
}

export function VariableAutocompleteField({
  value,
  onChange,
  scope,
  ariaLabel,
  placeholder,
  className,
  style,
  id,
  disabled,
  readOnly,
  multiline,
  rows = 3,
  inputRef,
}: BaseProps) {
  const localId = useId();
  const elementId = id ?? `var-input-${localId.replace(/:/g, '_')}`;
  const internalRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const setRef = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    internalRef.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef && 'current' in inputRef) {
      (inputRef as { current: HTMLInputElement | HTMLTextAreaElement | null }).current = el;
    }
  };
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  // Escape sets `dismissed`; any text/cursor change re-opens the popup.
  const [dismissed, setDismissed] = useState(false);

  const suggestions = useMemo(() => {
    if (dismissed) return [] as VariableSuggestion[];
    const start = getOpenTokenStart(value, cursor);
    if (start === -1) return [] as VariableSuggestion[];
    const fragment = value
      .slice(start + 2, cursor)
      .trim()
      .toLowerCase();
    return collectVariableSuggestions(scope).filter((s) =>
      fragment.length === 0 ? true : s.key.toLowerCase().includes(fragment),
    );
  }, [cursor, dismissed, scope, value]);

  // Keep `active` in range when suggestions change.
  useEffect(() => {
    if (active >= suggestions.length) setActive(0);
  }, [active, suggestions.length]);

  const insert = (s: VariableSuggestion) => {
    const el = internalRef.current;
    const fromCursor = el?.selectionStart ?? cursor;
    const { nextValue, nextCursor } = applySuggestion(value, fromCursor, s);
    onChange(nextValue);
    setActive(0);
    setDismissed(true); // close after insert; user can type again to reopen
    requestAnimationFrame(() => {
      el?.focus();
      try {
        el?.setSelectionRange(nextCursor, nextCursor);
      } catch {
        // Some inputs (e.g. type=email) refuse setSelectionRange; skip.
      }
      setCursor(nextCursor);
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const picked = suggestions[active];
      if (picked) insert(picked);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setActive(0);
      setDismissed(true);
    }
  };

  const onSelect = () => {
    const el = internalRef.current;
    setCursor(el?.selectionStart ?? 0);
  };

  const sharedProps = {
    id: elementId,
    value,
    placeholder,
    'aria-label': ariaLabel,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': suggestions.length > 0,
    'aria-controls': suggestions.length > 0 ? `${elementId}-listbox` : undefined,
    role: 'combobox' as const,
    autoComplete: 'off',
    spellCheck: false,
    disabled,
    readOnly,
    onKeyDown,
    onSelect,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
      setCursor(e.target.selectionStart ?? e.target.value.length);
      setDismissed(false);
    },
    style,
    className: cn(
      'h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30',
      className,
    ),
  };

  return (
    <div className="relative w-full">
      {multiline ? (
        <textarea
          {...sharedProps}
          ref={setRef}
          rows={rows}
          className={cn(sharedProps.className, 'h-auto py-1.5 leading-snug')}
        />
      ) : (
        <input {...sharedProps} ref={setRef} />
      )}
      {suggestions.length > 0 && (
        <ul
          id={`${elementId}-listbox`}
          role="listbox"
          aria-label={`${ariaLabel} suggestions`}
          className="absolute left-0 top-full z-30 mt-1 max-h-56 w-full min-w-[240px] overflow-y-auto rounded-sm border border-border bg-card text-xs shadow-elevated"
        >
          {suggestions.map((s, i) => {
            const isActive = i === active;
            return (
              <li
                key={s.key}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(s);
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-text-primary',
                  isActive ? 'bg-accent/10' : 'hover:bg-accent/5',
                )}
              >
                <span className="font-mono text-[0.6875rem]">{s.key}</span>
                <span className="text-[0.625rem] uppercase tracking-wide text-text-dim">
                  {s.source}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
