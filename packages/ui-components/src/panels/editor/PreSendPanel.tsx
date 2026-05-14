// Pre-send validation panel. Sits above the Send button on the Editor
// surface when `local.settings.validateOnSend` is true. Pulls warnings
// (yellow, non-blocking) and blockers (red, Send disabled) from
// `core/preSendValidation` and renders them in a compact list.
//
// The Send button consumes `blockers.length > 0` to disable itself,
// which the surrounding EditorPanel reads from this component's
// returned validation object — exposed via the `usePreSendValidation`
// hook below so the disable wiring stays type-safe.

import { useMemo } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { Request as ApiRequest } from '@apicircle/shared';
import {
  preSendValidation,
  type PreSendBlocker,
  type PreSendValidationResult,
  type PreSendWarning,
  type ResolutionScope,
} from '@apicircle/core';
import { cn } from '../../primitives/cn';

export interface PreSendPanelProps {
  request: ApiRequest | null | undefined;
  /** From `local.settings.validateOnSend`. Hidden entirely when false. */
  enabled: boolean;
  /**
   * Pre-computed validation result. The host (EditorPanel) calls
   * `usePreSendValidation` once and threads the result here so the hook
   * doesn't run twice per render. Optional for any caller that doesn't
   * have a result handy — we fall back to an empty result in that case.
   */
  validation?: PreSendValidationResult;
}

/**
 * Hook the EditorPanel uses to pull the validation result. Memoized on
 * the request + scope shape so unrelated state changes don't re-validate.
 *
 * Accepts `null | undefined` for `request` because EditorPanel renders
 * an empty-state when nothing is selected; React hook rules require us
 * to call the hook unconditionally, so this short-circuits instead.
 */
export function usePreSendValidation(
  request: ApiRequest | null | undefined,
  scope: ResolutionScope,
  enabled: boolean,
): PreSendValidationResult {
  return useMemo(() => {
    if (!enabled || !request) return { warnings: [], blockers: [] };
    return preSendValidation({ request, scope });
  }, [request, scope, enabled]);
}

const EMPTY_VALIDATION: PreSendValidationResult = { warnings: [], blockers: [] };

export function PreSendPanel({ request, enabled, validation }: PreSendPanelProps) {
  const { warnings, blockers } = validation ?? EMPTY_VALIDATION;
  if (!enabled || !request) return null;
  if (warnings.length === 0 && blockers.length === 0) return null;

  return (
    <section
      aria-label="Pre-send validation"
      className="flex flex-col gap-1.5 rounded-sm border border-border-subtle bg-surface px-3 py-2"
    >
      {blockers.map((b, i) => (
        <BlockerRow key={`b-${i}`} blocker={b} />
      ))}
      {warnings.map((w, i) => (
        <WarningRow key={`w-${i}`} warning={w} />
      ))}
    </section>
  );
}

function BlockerRow({ blocker }: { blocker: PreSendBlocker }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/5 px-2 py-1.5 text-[0.6875rem] text-text-primary',
      )}
    >
      <ShieldAlert size={12} className="mt-0.5 shrink-0 text-danger" />
      <span>{blocker.message}</span>
    </div>
  );
}

function WarningRow({ warning }: { warning: PreSendWarning }) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/5 px-2 py-1.5 text-[0.6875rem] text-text-primary',
      )}
    >
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" />
      <span>{warning.message}</span>
    </div>
  );
}
