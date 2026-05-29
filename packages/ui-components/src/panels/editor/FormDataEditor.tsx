import { useRef } from 'react';
import { FileUp, Plus, Trash2, X } from 'lucide-react';
import type { FormDataRow, GlobalFileAsset, Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { useRowKeyboardNav } from './useRowKeyboardNav';

interface FormDataEditorProps {
  request: ApiRequest;
}

export function FormDataEditor({ request }: FormDataEditorProps) {
  const setRequestFormRows = useWorkspaceStore((s) => s.setRequestFormRows);
  const attachFormFile = useWorkspaceStore((s) => s.attachFormFile);
  const detachFormFile = useWorkspaceStore((s) => s.detachFormFile);
  const setFormRowGlobalFileAsset = useWorkspaceStore((s) => s.setFormRowGlobalFileAsset);
  const globalFiles = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.files ?? {}) : [],
  );

  const rows: FormDataRow[] =
    request.body.type === 'form-data' ? (request.body.formRows ?? []) : [];

  const update = (index: number, next: FormDataRow) => {
    setRequestFormRows(
      request.id,
      rows.map((r, i) => (i === index ? next : r)),
    );
  };

  const setKind = (index: number, kind: 'text' | 'file') => {
    const current = rows[index];
    if (current.kind === kind) return;
    if (kind === 'text') {
      update(index, { kind: 'text', key: current.key, value: '', enabled: current.enabled });
    } else {
      update(index, { kind: 'file', key: current.key, slotId: null, enabled: current.enabled });
    }
  };

  const addRow = (kind: 'text' | 'file') => {
    const blank: FormDataRow =
      kind === 'text'
        ? { kind: 'text', key: '', value: '', enabled: true }
        : { kind: 'file', key: '', slotId: null, enabled: true };
    setRequestFormRows(request.id, [...rows, blank]);
  };

  const removeRow = (index: number) => {
    setRequestFormRows(
      request.id,
      rows.filter((_, i) => i !== index),
    );
  };

  // Enter on the last value field appends a text row; Arrow Up/Down move
  // focus between rows on the same column. Adds default to text rows
  // since they're the more common case.
  const { onKeyDown } = useRowKeyboardNav({
    ariaPrefix: 'Form-data row',
    fields: ['key', 'value'],
    rowCount: rows.length,
    isRowEmpty: (i) => {
      const r = rows[i];
      if (!r) return false;
      if (r.kind === 'text') return r.key === '' && r.value === '';
      return r.key === '' && !r.slotId;
    },
    onAdd: () => addRow('text'),
    onRemove: removeRow,
  });

  return (
    <div role="group" aria-label="Form data" className="flex flex-col gap-1">
      {rows.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No fields yet. Add a text field or a file upload.
        </p>
      )}

      {rows.map((row, index) => (
        <FormDataRowView
          key={index}
          row={row}
          index={index}
          onKindChange={setKind}
          onUpdate={update}
          onRemove={removeRow}
          onPickFile={(file) => void attachFormFile(request.id, index, file)}
          onUseGlobalFile={(fileAssetId) =>
            void setFormRowGlobalFileAsset(request.id, index, fileAssetId)
          }
          onClearFile={() => void detachFormFile(request.id, index)}
          globalFiles={globalFiles}
          onCellKeyDown={onKeyDown}
        />
      ))}

      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => addRow('text')}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
        >
          <Plus size={12} />
          Add text
        </button>
        <button
          type="button"
          onClick={() => addRow('file')}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
        >
          <FileUp size={12} />
          Add file
        </button>
      </div>
      {rows.some((r) => r.kind === 'file') && (
        <p className="mt-1 text-[0.6875rem] text-text-dim">
          Files are stored locally and pushed to <code>.apicircle/attachments/</code> on save.
          Refused above 100 MB.
        </p>
      )}
    </div>
  );
}

interface RowViewProps {
  row: FormDataRow;
  index: number;
  onKindChange: (index: number, kind: 'text' | 'file') => void;
  onUpdate: (index: number, next: FormDataRow) => void;
  onRemove: (index: number) => void;
  onPickFile: (file: File) => void;
  onUseGlobalFile: (fileAssetId: string | null) => void;
  onClearFile: () => void;
  globalFiles: GlobalFileAsset[];
  /** Keyboard nav handler from useRowKeyboardNav. */
  onCellKeyDown: (e: React.KeyboardEvent<HTMLElement>, rowIndex: number, field: string) => void;
}

function FormDataRowView({
  row,
  index,
  onKindChange,
  onUpdate,
  onRemove,
  onPickFile,
  onUseGlobalFile,
  onClearFile,
  globalFiles,
  onCellKeyDown,
}: RowViewProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={row.enabled}
        onChange={(e) =>
          onUpdate(
            index,
            row.kind === 'text'
              ? { ...row, enabled: e.target.checked }
              : { ...row, enabled: e.target.checked },
          )
        }
        aria-label={`Enable form-data row ${index + 1}`}
        style={{ accentColor: 'rgb(var(--accent))' }}
      />

      <div role="radiogroup" aria-label={`Form-data row ${index + 1} kind`} className="flex">
        <button
          type="button"
          role="radio"
          aria-checked={row.kind === 'text'}
          onClick={() => onKindChange(index, 'text')}
          className={cn(
            'h-7 rounded-l-sm border border-r-0 border-border px-2 text-[0.6875rem]',
            row.kind === 'text'
              ? 'bg-accent/15 text-accent border-accent/40'
              : 'bg-surface text-text-muted',
          )}
        >
          Text
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={row.kind === 'file'}
          onClick={() => onKindChange(index, 'file')}
          className={cn(
            'h-7 rounded-r-sm border border-border px-2 text-[0.6875rem]',
            row.kind === 'file'
              ? 'bg-accent/15 text-accent border-accent/40'
              : 'bg-surface text-text-muted',
          )}
        >
          File
        </button>
      </div>

      <input
        type="text"
        value={row.key}
        onChange={(e) =>
          onUpdate(
            index,
            row.kind === 'text' ? { ...row, key: e.target.value } : { ...row, key: e.target.value },
          )
        }
        onKeyDown={(e) => onCellKeyDown(e, index, 'key')}
        placeholder="Field name"
        aria-label={`Form-data row ${index + 1} key`}
        className="h-7 flex-1 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
      />

      {row.kind === 'text' ? (
        <input
          type="text"
          value={row.value}
          onChange={(e) => onUpdate(index, { ...row, value: e.target.value })}
          onKeyDown={(e) => onCellKeyDown(e, index, 'value')}
          placeholder="Field value"
          aria-label={`Form-data row ${index + 1} value`}
          className="h-7 flex-[2] rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
      ) : (
        <div className="flex h-7 flex-[2] items-center gap-2 rounded-sm border border-border bg-card px-2 text-xs">
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            aria-label={`Form-data row ${index + 1} file`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
              // Reset so the same file can be re-picked.
              e.target.value = '';
            }}
          />
          {row.slotId && row.filename ? (
            <>
              <span className="truncate text-text-primary" title={row.filename}>
                {row.filename}
              </span>
              {row.globalFileAssetId && (
                <span className="shrink-0 rounded-sm border border-accent/30 bg-accent/10 px-1 text-[0.625rem] text-accent">
                  library
                </span>
              )}
              <span className="ml-auto shrink-0 text-text-dim">{formatSize(row.size ?? 0)}</span>
              <button
                type="button"
                onClick={onClearFile}
                className="shrink-0 text-text-faint hover:text-danger"
                aria-label={`Clear file on form-data row ${index + 1}`}
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-primary"
            >
              <FileUp size={12} />
              Choose file
            </button>
          )}
          {globalFiles.length > 0 && (
            <select
              aria-label={`Form-data row ${index + 1} file asset`}
              value={row.globalFileAssetId ?? ''}
              onChange={(e) => onUseGlobalFile(e.target.value || null)}
              className="h-5 max-w-[44%] shrink-0 rounded-sm border border-border bg-surface px-1 text-[0.625rem] text-text-muted focus:border-accent focus:outline-none"
            >
              <option value="">Library...</option>
              {globalFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onRemove(index)}
        className="text-text-faint hover:text-danger"
        aria-label={`Remove form-data row ${index + 1}`}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
