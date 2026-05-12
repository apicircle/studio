import { ArrowRight, ShieldAlert, Sparkles, Zap } from 'lucide-react';
import type { MockEndpoint } from '@apicircle/shared';
import { cn } from '../../primitives/cn';
import type { MockNodeSelection } from './MockNodeEditor';

// Visual pipeline for a mock endpoint, single horizontal row:
//
//   [Endpoint] → [Validation (N)] → pass → [Rules (M)] → no match → [Default]
//
// Arrows align with the vertical center of the cards. The lists of
// validation rules + response rules used to render as branch chips in
// the flow itself; that's been moved to the body-panel overviews so
// the flow stays a clean pipeline view.

const tone = {
  selected: 'border-accent/70 bg-accent/10 shadow-[0_0_0_2px_rgba(var(--accent),0.15)]',
  idle: 'border-border bg-card hover:border-border-strong',
};

interface FlowProps {
  serverId: string;
  endpoint: MockEndpoint;
  selection: MockNodeSelection;
  onSelect: (next: MockNodeSelection) => void;
}

export function MockEndpointFlow(props: FlowProps) {
  // Both counters expose `(enabled / total)` when some rules are off so
  // the flow node faithfully mirrors what the runtime will actually do
  // — disabled rules are skipped at the request, but the chips remain
  // visible in the flow with strikethrough so the user knows they exist.
  const enabledValidationCount = props.endpoint.requestValidation.filter((r) => r.enabled).length;
  const totalValidationCount = props.endpoint.requestValidation.length;
  const enabledRuleCount = props.endpoint.responseRules.filter((r) => r.enabled).length;
  const totalRuleCount = props.endpoint.responseRules.length;

  return (
    // Outer flex centers the four-node block horizontally; the inner
    // grid keeps the auto-sizing semantics (so each node sizes to its
    // content rather than the full sidebar width).
    <div className="flex w-full justify-center">
      <div
        role="group"
        aria-label="Mock endpoint flow"
        className="inline-grid grid-cols-[auto_auto_auto_auto_auto_auto_auto] items-center gap-3 text-[0.6875rem]"
      >
        <EndpointNode {...props} />
        <ArrowEdge />
        <ValidationNode
          {...props}
          enabledCount={enabledValidationCount}
          totalCount={totalValidationCount}
        />
        <ArrowEdge label="pass" />
        <RulesNode {...props} enabledCount={enabledRuleCount} totalCount={totalRuleCount} />
        <ArrowEdge label="no match" />
        <DefaultNode {...props} />
      </div>
    </div>
  );
}

function NodeBox({
  active,
  onClick,
  ariaLabel,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex flex-col items-stretch gap-1 rounded-sm border px-3 py-2 text-left transition-colors min-w-[140px]',
        active ? tone.selected : tone.idle,
        className,
      )}
    >
      {children}
    </button>
  );
}

function ArrowEdge({ label }: { label?: string }) {
  // Edge column: pure horizontal arrow + optional label below it.
  // `items-center` on the parent grid takes care of vertical alignment
  // so the arrow lands on the middle of the NodeBox row regardless of
  // text-wrap-induced height differences.
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 px-1 text-text-faint">
      <ArrowRight size={14} aria-hidden="true" />
      {label && (
        <span className="rounded-sm bg-card px-1 py-0.5 text-[0.5625rem] uppercase tracking-wider text-text-dim">
          {label}
        </span>
      )}
    </div>
  );
}

function EndpointNode({ endpoint, selection, onSelect }: FlowProps) {
  const active = selection.kind === 'endpoint';
  return (
    <NodeBox
      active={active}
      onClick={() => onSelect({ kind: 'endpoint' })}
      ariaLabel={`Endpoint ${endpoint.method} ${endpoint.pathPattern}`}
    >
      <span className="text-[0.5625rem] uppercase tracking-wider text-text-dim">Endpoint</span>
      <div className="flex items-center gap-1.5">
        <MethodChip method={endpoint.method} />
        <code className="truncate font-mono text-text-primary">{endpoint.pathPattern}</code>
      </div>
    </NodeBox>
  );
}

function ValidationNode({
  endpoint,
  selection,
  onSelect,
  enabledCount,
  totalCount,
}: FlowProps & { enabledCount: number; totalCount: number }) {
  // Each chip carries its own enabled flag so disabled rules render dimmed
  // rather than vanishing — the user can still see they exist.
  const chips = endpoint.requestValidation.map((r) => ({
    status: r.failResponse.status,
    enabled: r.enabled,
  }));
  // Show "(enabled / total)" when some rules are off so the discrepancy is
  // visible in the flow view; collapse to "(N)" when everything is enabled.
  const label =
    totalCount === enabledCount
      ? `Validation (${totalCount})`
      : `Validation (${enabledCount}/${totalCount})`;
  return (
    <NodeBox
      active={selection.kind === 'validation' || selection.kind === 'validation-rule'}
      onClick={() => onSelect({ kind: 'validation' })}
      ariaLabel="Validation node"
    >
      <span className="flex items-center gap-1 text-[0.5625rem] uppercase tracking-wider text-text-dim">
        <ShieldAlert size={10} aria-hidden="true" />
        {label}
      </span>
      {chips.length === 0 ? (
        <span className="text-[0.625rem] text-text-muted">No rules</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {chips.slice(0, 4).map((c, i) => (
            <span
              key={i}
              className={
                c.enabled
                  ? 'rounded-sm border border-danger/40 bg-danger/5 px-1 py-0 font-mono text-[0.5625rem] text-danger'
                  : 'rounded-sm border border-border bg-surface px-1 py-0 font-mono text-[0.5625rem] text-text-muted line-through'
              }
              title={c.enabled ? undefined : 'Disabled — skipped at runtime'}
            >
              {c.status}
            </span>
          ))}
          {chips.length > 4 && (
            <span className="text-[0.5625rem] text-text-dim">+{chips.length - 4}</span>
          )}
        </span>
      )}
    </NodeBox>
  );
}

function RulesNode({
  endpoint,
  selection,
  onSelect,
  enabledCount,
  totalCount,
}: FlowProps & { enabledCount: number; totalCount: number }) {
  // Mirror ValidationNode: render every chip, dim and strike-through the
  // disabled ones so users can see at a glance which rules exist but
  // won't fire at runtime.
  const chips = endpoint.responseRules.map((r) => ({
    status: r.response.status,
    enabled: r.enabled,
  }));
  const label =
    totalCount === enabledCount ? `Rules (${totalCount})` : `Rules (${enabledCount}/${totalCount})`;
  return (
    <NodeBox
      active={selection.kind === 'rules' || selection.kind === 'rule'}
      onClick={() => onSelect({ kind: 'rules' })}
      ariaLabel="Response rules node"
    >
      <span className="flex items-center gap-1 text-[0.5625rem] uppercase tracking-wider text-text-dim">
        <Sparkles size={10} aria-hidden="true" />
        {label}
      </span>
      {chips.length === 0 ? (
        <span className="text-[0.625rem] text-text-muted">No rules</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {chips.slice(0, 4).map((c, i) => (
            <span
              key={i}
              className={
                c.enabled
                  ? 'rounded-sm border border-success/40 bg-success/5 px-1 py-0 font-mono text-[0.5625rem] text-success'
                  : 'rounded-sm border border-border bg-surface px-1 py-0 font-mono text-[0.5625rem] text-text-muted line-through'
              }
              title={c.enabled ? undefined : 'Disabled — skipped at runtime'}
            >
              {c.status}
            </span>
          ))}
          {chips.length > 4 && (
            <span className="text-[0.5625rem] text-text-dim">+{chips.length - 4}</span>
          )}
        </span>
      )}
    </NodeBox>
  );
}

function DefaultNode({ endpoint, selection, onSelect }: FlowProps) {
  const active = selection.kind === 'default';
  return (
    <NodeBox
      active={active}
      onClick={() => onSelect({ kind: 'default' })}
      ariaLabel="Default response node"
    >
      <span className="flex items-center gap-1 text-[0.5625rem] uppercase tracking-wider text-text-dim">
        <Zap size={10} aria-hidden="true" />
        Default
      </span>
      <div className="flex items-center gap-1.5">
        <StatusChip status={endpoint.defaultResponse.status} />
        <span className="text-[0.625rem] text-text-muted">
          {endpoint.defaultResponse.body.type}
        </span>
      </div>
    </NodeBox>
  );
}

function MethodChip({ method }: { method: string }) {
  const t =
    method === 'GET'
      ? 'border-accent/40 text-accent'
      : method === 'POST'
        ? 'border-success/40 text-success'
        : method === 'PUT' || method === 'PATCH'
          ? 'border-warning/40 text-warning'
          : method === 'DELETE'
            ? 'border-danger/40 text-danger'
            : 'border-border text-text-muted';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm border bg-surface px-1 py-0 font-mono text-[0.5625rem] uppercase',
        t,
      )}
    >
      {method}
    </span>
  );
}

function StatusChip({ status }: { status: number }) {
  const t =
    status >= 200 && status < 300
      ? 'border-success/40 text-success'
      : status >= 400 && status < 500
        ? 'border-warning/40 text-warning'
        : status >= 500
          ? 'border-danger/40 text-danger'
          : 'border-border text-text-muted';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm border bg-surface px-1 py-0 font-mono text-[0.625rem]',
        t,
      )}
    >
      {status}
    </span>
  );
}
