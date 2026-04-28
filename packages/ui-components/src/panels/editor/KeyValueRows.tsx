import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ResolutionScope } from '@apicircle/core';
import { VariableAutocompleteField } from '../../editors/VariableAutocompleteField';

export interface KeyValueRow {
  key: string;
  value: string;
  enabled: boolean;
}

interface KeyValueRowsProps {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  // Optional autocomplete suggestions for the key column
  keySuggestions?: (prefix: string) => Array<{ name: string; description?: string }>;
  // Optional renderer for an extra column on the right (e.g. value picker)
  rightSlot?: (row: KeyValueRow, index: number) => ReactNode;
  ariaLabel: string;
  /**
   * Optional — enables `{{var}}` autocomplete on the value column. When
   * absent, falls back to a plain <input>.
   */
  valueScope?: ResolutionScope;
}

// Generic key/value editor used by Params and Headers tabs. Designed to be
// copy/move-friendly later (DnD reorder lands as a follow-up).
export function KeyValueRows({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  keySuggestions,
  rightSlot,
  ariaLabel,
  valueScope,
}: KeyValueRowsProps) {
  const update = (index: number, patch: Partial<KeyValueRow>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addRow = () => onChange([...rows, { key: '', value: '', enabled: true }]);
  const removeRow = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-col gap-1">
      {rows.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No entries yet.
        </p>
      )}
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => update(index, { enabled: e.target.checked })}
            aria-label={`Enable row ${index + 1}`}
            style={{ accentColor: 'rgb(var(--accent))' }}
          />
          <input
            type="text"
            list={keySuggestions ? `${ariaLabel}-keys` : undefined}
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(e) => update(index, { key: e.target.value })}
            aria-label={`${ariaLabel} key ${index + 1}`}
            className="h-7 flex-1 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          {valueScope ? (
            <div className="flex-[2]">
              <VariableAutocompleteField
                value={row.value}
                onChange={(v) => update(index, { value: v })}
                scope={valueScope}
                ariaLabel={`${ariaLabel} value ${index + 1}`}
                placeholder={valuePlaceholder}
                className="h-7"
              />
            </div>
          ) : (
            <input
              type="text"
              value={row.value}
              placeholder={valuePlaceholder}
              onChange={(e) => update(index, { value: e.target.value })}
              aria-label={`${ariaLabel} value ${index + 1}`}
              className="h-7 flex-[2] rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          )}
          {rightSlot?.(row, index)}
          <button
            type="button"
            onClick={() => removeRow(index)}
            className="text-text-faint hover:text-danger"
            aria-label={`Delete ${ariaLabel} row ${index + 1}`}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {keySuggestions && (
        <datalist id={`${ariaLabel}-keys`}>
          {keySuggestions('').map((s) => (
            <option key={s.name} value={s.name}>
              {s.description}
            </option>
          ))}
        </datalist>
      )}
      <button
        type="button"
        onClick={addRow}
        className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Plus size={12} />
        Add row
      </button>
    </div>
  );
}
