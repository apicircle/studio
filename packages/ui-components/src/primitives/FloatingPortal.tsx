import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Render `children` into `document.body`, out of every clipping ancestor — the
 * floating layer's host (see `./floating` for placement and dismissal).
 */
export function FloatingPortal({ children }: { children: ReactNode }) {
  /* v8 ignore next -- non-DOM renders (SSR) only; every test runs in a DOM. */
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
