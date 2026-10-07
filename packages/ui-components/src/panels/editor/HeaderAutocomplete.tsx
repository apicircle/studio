// Rich popover autocomplete for the Headers tab. Replaces the bare
// <datalist> with a styled list that shows: header name, description, and a
// "browser-only" or "auto" badge for reserved entries.
//
// The value column uses `<HeaderValueRecommendations>` further down —
// rendered as an inline popover that opens when the value input is focused
// and closes on blur. Replaces the older chevron-driven popover so the UX
// matches the key column.
//
// Both lists are drawn on the floating layer (`primitives/floating`): a header
// row sits in a scrolling table inside a resizable panel, and a list drawn
// inside the row was cut off at the bottom of whichever of those clipped first.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import {
  getHeaderEntry,
  suggestHeaders,
  type HeaderEntry,
  type HeaderSuggestionMode,
} from '@apicircle/core';
import { cn } from '../../primitives/cn';
import { AnchoredPopover } from '../../primitives/AnchoredPopover';

interface HeaderKeyAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  /**
   * Filter suggestions by request- or response-side relevance. Defaults
   * to `'request'` for source-compat with the request editor's call
   * sites; the mock response editor passes `'response'`.
   */
  mode?: HeaderSuggestionMode;
}

export function HeaderKeyAutocomplete({
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
  mode = 'request',
}: HeaderKeyAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // When the input is empty (focused but un-typed), surface the full
  // sorted list — the popover scrolls. With 80+ entries in the dictionary
  // a small limit would crop the visible window to the alphabetically-first
  // letter only. Once the user types a prefix, cap to 12 — that's a
  // focused search, not a browse.
  const matches = useMemo(() => {
    const prefix = value.trim();
    return prefix ? suggestHeaders(prefix, 12, mode) : suggestHeaders('', undefined, mode);
  }, [value, mode]);
  // Hide the popover entirely when there are no matches (typing junk should
  // not trap the user under a "No matches" panel).
  const visible = open && matches.length > 0;

  useEffect(() => {
    setActiveIndex((i) => (i >= matches.length ? 0 : i));
  }, [matches]);

  useEffect(() => {
    if (!visible) return;
    const onDoc = (e: MouseEvent) => {
      // The list is portalled, so it is not inside the wrapper in the DOM.
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [visible]);

  const select = (entry: HeaderEntry) => {
    onChange(entry.name);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className={cn('relative flex-1', className)}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder ?? 'Header name'}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!visible) {
            if (e.key === 'ArrowDown') {
              setOpen(true);
              e.preventDefault();
            }
            return;
          }
          if (e.key === 'ArrowDown') {
            setActiveIndex((i) => (i + 1) % matches.length);
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
            e.preventDefault();
          } else if (e.key === 'Enter' && matches[activeIndex]) {
            select(matches[activeIndex]);
            e.preventDefault();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? `${ariaLabel}-listbox` : undefined}
        autoComplete="off"
        spellCheck={false}
        className="h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
      />
      <AnchoredPopover
        ref={listRef}
        open={visible}
        anchorRef={wrapRef}
        matchAnchorWidth="min"
        maxHeight={256}
        onAnchorHidden={() => setOpen(false)}
        className="min-w-[260px] overflow-y-auto rounded-sm border border-border bg-card shadow-lg"
      >
        <ul id={`${ariaLabel}-listbox`} role="listbox" aria-label="Header suggestions">
          {matches.map((entry, i) => (
            <li key={entry.name}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(entry);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  'flex w-full items-start gap-2 px-2 py-1.5 text-left text-[0.6875rem]',
                  i === activeIndex
                    ? 'bg-accent/10 text-text-primary'
                    : 'text-text-muted hover:bg-surface',
                )}
              >
                <code className="shrink-0 font-mono text-text-primary">{entry.name}</code>
                <span className="flex-1 truncate text-text-dim">{entry.description}</span>
                {entry.reserved === 'app' ? (
                  <span
                    title={entry.reservedNote ?? 'Auto-injected at send'}
                    className="inline-flex items-center gap-0.5 rounded-sm border border-accent/40 bg-accent/5 px-1 py-0.5 text-[0.5625rem] uppercase tracking-wider text-accent"
                  >
                    <Sparkles size={9} /> auto
                  </span>
                ) : entry.reserved === 'browser' ? (
                  <span
                    title={entry.reservedNote ?? 'Set by the browser; cannot override from web'}
                    className="inline-flex items-center gap-0.5 rounded-sm border border-amber/30 bg-amber/5 px-1 py-0.5 text-[0.5625rem] uppercase tracking-wider text-amber"
                  >
                    <Lock size={9} /> browser
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </div>
  );
}

interface HeaderValueRecommendationsProps {
  headerKey: string;
  /** Current text in the value input — used to prefix-filter the curated list. */
  currentValue: string;
  /** True when the value input (or this popover) currently holds focus. */
  isFocused: boolean;
  onPick: (value: string) => void;
  ariaLabel: string;
}

/**
 * True when the cursor is inside an unclosed `{{` reference — meaning the
 * variable autocomplete in `VariableAutocompleteField` is the one driving
 * the suggestion UX. We yield to it and stay hidden.
 */
function hasOpenVariableToken(text: string): boolean {
  const lastOpen = text.lastIndexOf('{{');
  if (lastOpen === -1) return false;
  return !text.slice(lastOpen + 2).includes('}}');
}

/**
 * Inline popover that surfaces the dictionary's curated values for the
 * row's current header. Mirrors the key column UX: appears when the value
 * input is focused, prefix-filters as the user types, dismisses on blur.
 */
export function HeaderValueRecommendations({
  headerKey,
  currentValue,
  isFocused,
  onPick,
  ariaLabel,
}: HeaderValueRecommendationsProps) {
  const entry = getHeaderEntry(headerKey);
  const values = useMemo(() => entry?.values ?? [], [entry]);
  // The list opens under the box its caller put it in — the `relative` wrapper
  // around the value input — so that box is the anchor. A marker element finds
  // it, which keeps the anchor out of every caller's props.
  const anchorRef = useRef<HTMLElement | null>(null);

  const filtered = useMemo(() => {
    if (values.length === 0) return [];
    const prefix = currentValue.trim().toLowerCase();
    if (!prefix) return values;
    // Substring match (not just prefix) — composite header values like
    // `gzip, deflate, br` should surface when the user types `gzip`.
    return values.filter((v) => v.toLowerCase().includes(prefix));
  }, [values, currentValue]);

  // Yield to the `{{var}}` autocomplete in VariableAutocompleteField when
  // the user is mid-token — only one popover should show at a time.
  const open =
    isFocused && values.length > 0 && filtered.length > 0 && !hasOpenVariableToken(currentValue);

  return (
    <>
      <span
        hidden
        ref={(el) => {
          anchorRef.current = el?.parentElement ?? null;
        }}
      />
      <AnchoredPopover
        open={open}
        anchorRef={anchorRef}
        matchAnchorWidth="min"
        maxHeight={224}
        className="min-w-[180px] overflow-y-auto rounded-sm border border-border bg-card shadow-lg"
      >
        <ul role="listbox" aria-label={ariaLabel} className="flex flex-col">
          {filtered.map((v) => (
            <li key={v}>
              <button
                type="button"
                // onMouseDown + preventDefault keeps focus on the input so the
                // parent's onBlur (which closes this popover) doesn't fire
                // before the click registers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(v);
                }}
                className="block w-full px-2 py-1 text-left text-[0.6875rem] text-text-muted hover:bg-surface hover:text-text-primary"
              >
                {v}
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </>
  );
}
