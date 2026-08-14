import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from './cn';

export interface TabDef {
  id: string;
  label: ReactNode;
  /** Optional trailing count/badge shown after the label. */
  count?: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist. */
  label: string;
  /**
   * Stable prefix for the tab/panel element ids. Pass one when you want to wire
   * the panel with {@link tabPanelProps}; omit it and a generated id is used for
   * the tablist alone (no panel association).
   */
  idBase?: string;
  className?: string;
}

/**
 * A real ARIA tablist with roving-tabindex keyboard support (←/→/Home/End,
 * skipping disabled tabs). The panels had at least six hand-rolled tab strips,
 * and the most important one — the request editor's Params/Headers/Auth/Body…
 * row — was plain buttons with no tab semantics or arrow-key nav. This is the
 * single implementation they should all move onto.
 *
 * For the associated panel, pass a stable `idBase` and spread
 * {@link tabPanelProps} onto your panel container.
 */
export function Tabs({ tabs, activeId, onChange, label, idBase, className }: TabsProps) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (dir: 1 | -1 | 'home' | 'end') => {
    const enabled = tabs.filter((t) => !t.disabled);
    if (enabled.length === 0) return;
    const curr = enabled.findIndex((t) => t.id === activeId);
    let next: number;
    if (dir === 'home') next = 0;
    else if (dir === 'end') next = enabled.length - 1;
    else next = (curr + dir + enabled.length) % enabled.length;
    const target = enabled[next];
    onChange(target.id);
    refs.current[target.id]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        move('home');
        break;
      case 'End':
        e.preventDefault();
        move('end');
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex items-center gap-1', className)}
    >
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={idBase ? `${base}-panel-${t.id}` : undefined}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-sm border px-3 text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-card',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-transparent text-text-muted hover:bg-surface hover:text-text-primary',
            )}
          >
            {t.label}
            {t.count != null ? (
              <span className={cn('text-[0.625rem]', active ? 'text-accent/80' : 'text-text-dim')}>
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Props for the panel a tablist controls. Use the SAME `idBase` you passed to
 * `Tabs`, plus the active tab's id:
 *
 *   <Tabs idBase="editor" activeId={t} … />
 *   <div {...tabPanelProps('editor', t)}>{content}</div>
 */
export function tabPanelProps(
  idBase: string,
  id: string,
): { id: string; role: 'tabpanel'; 'aria-labelledby': string } {
  return {
    id: `${idBase}-panel-${id}`,
    role: 'tabpanel',
    'aria-labelledby': `${idBase}-tab-${id}`,
  };
}
