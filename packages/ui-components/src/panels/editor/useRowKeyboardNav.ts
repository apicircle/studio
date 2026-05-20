import { useCallback } from 'react';

/**
 * Shared keyboard helpers for the editor's row-based grids (AssertionsTab,
 * ContextTab, FormDataEditor, KeyValueRows). Cell focus follows aria-labels
 * of the form `${ariaPrefix} ${field} ${rowIndex+1}` — the caller wires the
 * matching aria-labels onto the inputs.
 *
 * Behavior:
 *  - Enter on the last row's last field → calls onAdd, then focuses the new
 *    row's first field
 *  - Backspace on an empty row → calls onRemove, then focuses the previous
 *    row at the same column
 *  - ArrowUp / ArrowDown → move focus between rows on the same column
 */
export interface RowKeyboardNavOptions {
  /** Aria-label prefix used to discover sibling inputs (e.g. "Headers"). */
  ariaPrefix: string;
  /** Column names in their visual order. The last field triggers Enter-to-add. */
  fields: ReadonlyArray<string>;
  /** Total row count (drives end-of-list detection for Enter). */
  rowCount: number;
  /** Returns true when the row at `index` is "empty" — drives Backspace-removes. */
  isRowEmpty: (index: number) => boolean;
  /** Append a row + focus its first field. Caller wires the actual store mutation. */
  onAdd: () => void;
  /** Remove the row at `index`. */
  onRemove: (index: number) => void;
}

export function useRowKeyboardNav(opts: RowKeyboardNavOptions) {
  const { ariaPrefix, fields, rowCount, isRowEmpty, onAdd, onRemove } = opts;

  const focusCell = useCallback(
    (rowIndex: number, field: string) => {
      requestAnimationFrame(() => {
        const target = document.querySelector<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >(`[aria-label="${ariaPrefix} ${field} ${rowIndex + 1}"]`);
        target?.focus();
      });
    },
    [ariaPrefix],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>, rowIndex: number, field: string): void => {
      const lastField = fields[fields.length - 1];
      const isLastRow = rowIndex === rowCount - 1;

      if (e.key === 'Enter' && field === lastField && isLastRow) {
        e.preventDefault();
        onAdd();
        focusCell(rowIndex + 1, fields[0]);
        return;
      }
      // Backspace on a textarea is captured here only when the field is
      // empty — Backspace mid-text falls through to the native handler.
      if (
        e.key === 'Backspace' &&
        rowCount > 1 &&
        isRowEmpty(rowIndex) &&
        (e.target as HTMLInputElement).value === ''
      ) {
        e.preventDefault();
        onRemove(rowIndex);
        focusCell(Math.max(0, rowIndex - 1), field);
        return;
      }
      if (e.key === 'ArrowDown' && rowIndex < rowCount - 1) {
        e.preventDefault();
        focusCell(rowIndex + 1, field);
        return;
      }
      if (e.key === 'ArrowUp' && rowIndex > 0) {
        e.preventDefault();
        focusCell(rowIndex - 1, field);
      }
    },
    [fields, rowCount, isRowEmpty, onAdd, onRemove, focusCell],
  );

  return { onKeyDown, focusCell };
}
