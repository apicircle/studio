// Rich popover autocomplete for the Headers tab. Replaces the bare
// <datalist> with a styled list that shows: header name, description, and a
// "browser-only" or "auto" badge for reserved entries.
//
// Used as a drop-in for the key column. The value column uses
// `<HeaderValueSuggestions>` further down — a small chevron button that
// opens a popover of common values for the row's current key.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Lock, Sparkles } from 'lucide-react';
import { getHeaderEntry, suggestHeaders, type HeaderEntry } from '@apicircle/core';
import { cn } from '../../primitives/cn';

interface HeaderKeyAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}

export function HeaderKeyAutocomplete({
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
}: HeaderKeyAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => suggestHeaders(value, 12), [value]);
  // Hide the popover entirely when there are no matches (typing junk should
  // not trap the user under a "No matches" panel).
  const visible = open && matches.length > 0;

  useEffect(() => {
    setActiveIndex((i) => (i >= matches.length ? 0 : i));
  }, [matches]);

  useEffect(() => {
    if (!visible) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
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
        className="h-7 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
      />
      {visible && (
        <ul
          id={`${ariaLabel}-listbox`}
          role="listbox"
          aria-label="Header suggestions"
          className="absolute left-0 top-8 z-30 max-h-64 w-full min-w-[260px] overflow-y-auto rounded-sm border border-border bg-card shadow-lg"
        >
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
                  'flex w-full items-start gap-2 px-2 py-1.5 text-left text-[11px]',
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
                    className="inline-flex items-center gap-0.5 rounded-sm border border-accent/40 bg-accent/5 px-1 py-0.5 text-[9px] uppercase tracking-wider text-accent"
                  >
                    <Sparkles size={9} /> auto
                  </span>
                ) : entry.reserved === 'browser' ? (
                  <span
                    title={entry.reservedNote ?? 'Set by the browser; cannot override from web'}
                    className="inline-flex items-center gap-0.5 rounded-sm border border-amber/30 bg-amber/5 px-1 py-0.5 text-[9px] uppercase tracking-wider text-amber"
                  >
                    <Lock size={9} /> browser
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface HeaderValueSuggestionsProps {
  headerKey: string;
  onPick: (value: string) => void;
  ariaLabel: string;
}

export function HeaderValueSuggestions({
  headerKey,
  onPick,
  ariaLabel,
}: HeaderValueSuggestionsProps) {
  const entry = getHeaderEntry(headerKey);
  const values = entry?.values ?? [];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (values.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Common values for ${entry!.name}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary"
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={`Common values for ${entry!.name}`}
          className="absolute right-0 top-8 z-30 flex max-h-56 min-w-[180px] flex-col overflow-y-auto rounded-sm border border-border bg-card shadow-lg"
        >
          {values.map((v) => (
            <li key={v}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(v);
                  setOpen(false);
                }}
                className="block w-full px-2 py-1 text-left text-[11px] text-text-muted hover:bg-surface hover:text-text-primary"
              >
                {v}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
