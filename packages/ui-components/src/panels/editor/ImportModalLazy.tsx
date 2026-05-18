// Lazy boundary for the import modal.
//
// Why: the eager `ImportModal` pulls in `parseCurl` /
// `parsePostmanCollection` / `parsePostmanEnvironment` /
// `parseInsomniaCollection` plus their type-guards from `@apicircle/core`.
// Those parsers are a few hundred kilobytes of dead weight on initial
// app load — most users never open the modal in a session, and those
// who do can wait 50–100ms while we fetch the chunk.
//
// The wrapper renders nothing until `open` flips to true; on the first
// open we kick the dynamic import, render a tiny placeholder in Suspense,
// and then mount the real modal. Subsequent opens are instant (the
// chunk is cached).

import { lazy, Suspense } from 'react';

const InnerImportModal = lazy(() => import('./ImportModal'));

interface Props {
  open: boolean;
  onClose: () => void;
  parentFolderId?: string | null;
  initialText?: string;
  initialFormat?: 'auto' | 'postman' | 'postman-env' | 'insomnia' | 'curl' | 'apicircle';
}

export function ImportModalLazy(props: Props) {
  // Avoid even kicking the dynamic import until the user opens the modal.
  // Once they have, we keep the chunk warm — Suspense's fallback is a
  // near-instant flash so subsequent opens feel snappy.
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <InnerImportModal {...props} />
    </Suspense>
  );
}
