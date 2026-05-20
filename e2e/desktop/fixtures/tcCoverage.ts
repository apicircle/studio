// Re-export from the web e2e helper so spec source has a single source of
// truth for `tc()` / `tcRange()` / `tcCovered()`. The coverage scanner
// reads source for literal `tc('TC-...', ...)` calls and doesn't care
// which package defines the helper.

export { tc, tcRange, tcCovered, type TcId } from '../../web/fixtures/tcCoverage';
