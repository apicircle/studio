import { FileJson } from 'lucide-react';
import type { SpecAssetMeta } from '@apicircle/shared';
import { cn } from './cn';

// Small badge marking a Global File Asset as a parsed OpenAPI / Swagger spec.
// Shows the dialect + declared operation count ("OpenAPI 3 · 12 ops"); the full
// title/version land in the tooltip. Rendered on the Assets list row (icon
// only) and in the file editor's spec summary (with label).

const DIALECT_LABEL: Record<SpecAssetMeta['dialect'], string> = {
  'openapi-3': 'OpenAPI 3',
  'swagger-2': 'Swagger 2',
};

export interface SpecAssetBadgeProps {
  spec: SpecAssetMeta;
  className?: string;
  /** When true, drops the label text and shows just the icon + tooltip. */
  iconOnly?: boolean;
}

export function SpecAssetBadge({
  spec,
  className,
  iconOnly = false,
}: SpecAssetBadgeProps): JSX.Element {
  const dialect = DIALECT_LABEL[spec.dialect];
  const ops = `${spec.operationCount} op${spec.operationCount === 1 ? '' : 's'}`;
  const titleParts: string[] = [];
  if (spec.title) titleParts.push(spec.title);
  titleParts.push(dialect, ops);
  if (spec.version) titleParts.push(`v${spec.version}`);
  const title = titleParts.join(' · ');

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[0.625rem] text-accent',
        className,
      )}
      title={title}
      data-spec-dialect={spec.dialect}
      role="note"
      aria-label={`API spec: ${title}`}
    >
      <FileJson size={10} aria-hidden="true" />
      {!iconOnly && <span className="truncate">{`${dialect} · ${ops}`}</span>}
    </span>
  );
}
