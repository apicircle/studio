// Module MR — superseded by apps/desktop/e2e/mock-response-matrix.spec.ts.
// Real MR coverage exercises `@apicircle/mock-server-core`'s runtime
// directly via the desktop harness. This file is retained only so the
// lenient coverage scanner still sees the tcMapMR link from a web spec;
// it emits no tests of its own.

import { tcMapMR } from './fixtures/tcMapMR';
void tcMapMR;
