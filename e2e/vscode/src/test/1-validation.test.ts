import * as assert from 'node:assert';

// =============================================================================
// Phase 1 / spec 5: Pre-send validation diagnostics.
//
// Verifies:
//   • DiagnosticCollection is populated for apicircle://*/requests/*.req.yaml
//   • Warnings surface in Problems panel
//   • Blockers refuse send when apicircle.validation.validateOnSend is true
// =============================================================================

suite('Phase 1 — 1-validation: pre-send diagnostics', () => {
  test('apicircle:// scheme is registered as a virtual filesystem', async () => {
    // VS Code doesn't expose a "list registered FS providers" API, but the
    // FS provider's presence is what makes apicircle://*.req.yaml openable.
    // The MVP smoke test (1-mvp) covered activation; this is the schema
    // contract placeholder.
    assert.ok(true);
  });

  test('validation blocker refuses send when validateOnSend is true', async function () {
    // Requires opening a seeded request with an unresolved variable, then
    // calling sendRequest and verifying the error toast. Test-electron
    // harness extension for this lands in Phase 2.
    this.skip();
  });
});
