import { createContext } from 'react';

// Read-only flag for the mock endpoint editor tree. Provided by
// `MockEndpointEditor` (true for linked "run live" contract mocks) and read by
// `MockResponseEditor` so the Monaco body editor — which isn't a native form
// control, and so isn't covered by the editor's `<fieldset disabled>` — also
// goes read-only. Standalone module so the two editors don't form an import
// cycle.
export const MockReadOnlyContext = createContext(false);
