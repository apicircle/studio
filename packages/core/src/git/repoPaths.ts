// Canonical repo paths for everything API Circle Studio writes into a
// user's GitHub repo. Every file lives under a single `.apicircle/`
// dotfolder at the repo root so the repo can also host READMEs, CI
// configs, and unrelated tooling at the root without colliding with our
// payload.

/** The dotfolder under the repo root that owns every API-Circle-managed
 *  file in a Git-backed workspace. */
export const WORKSPACE_DIR = '.apicircle';

/** On-disk path for the synced workspace document inside a Git repo. */
export const WORKSPACE_JSON_PATH = `${WORKSPACE_DIR}/workspace.json`;

/** Directory holding per-attachment blob files (`<slotId>`). */
export const ATTACHMENTS_DIR = `${WORKSPACE_DIR}/attachments`;

/** Build the on-disk path for a single attachment slot. Caller is
 *  responsible for URL-encoding when this is passed to the GitHub
 *  Contents API. */
export function attachmentPath(slotId: string): string {
  return `${ATTACHMENTS_DIR}/${slotId}`;
}
