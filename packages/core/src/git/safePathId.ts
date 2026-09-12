// Workspace ids and attachment slot ids each become ONE path segment: of a
// repo path (`.apicircle/workspace-<id>/attachments/<slotId>`) that the Git
// clients turn into a Contents API URL, and of an on-disk directory under an
// apicircle root (`<root>/workspace-<id>/`). Both kinds of id are read out of
// files a collaborator can write — `workspace.json` and `registry.json` — so
// any value that could change which segment it lands in, or climb out of its
// parent, is refused rather than escaped. Escaping is not enough:
// `encodeURIComponent` leaves `.` and `..` intact and the renderer's fetch
// collapses dot segments, so `../../other/repo` would re-aim an authenticated
// request at a different repository.
//
// This is a denylist on purpose. Studio mints both kinds of id with
// `generateId()` (UUIDs) and the desktop mirror adds `imported-folder-<hex>`,
// but slot ids have always been free-form strings the clients encode segment
// by segment — a hand-written `"with spaces"` slot works today and must keep
// working. Only what changes a path's shape is refused:
//   - empty, or nothing but dots and whitespace: `.`, `..`, `...`, `.. `
//     (Windows drops trailing dots and spaces, so `.. ` IS `..` on disk)
//   - `/` and `\`, the separators on every platform we run on
//   - `%`, because a later layer may decode `%2e%2e` or `%2f` into the above
//   - `:`, for drive letters (`C:x`) and NTFS alternate data streams
//   - ASCII control characters, NUL included

const PATH_SHAPING_CHARS = /[/\\%:]/;
const DOTS_AND_WHITESPACE_ONLY = /^[.\s]*$/;
const PREVIEW_LENGTH = 64;

/** True when `value` is a string that is safe to use as a single path
 *  segment for a workspace id or attachment slot id. */
export function isSafePathId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (DOTS_AND_WHITESPACE_ONLY.test(value) || PATH_SHAPING_CHARS.test(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** The message every refusal uses. `kind` names the id in the user's terms
 *  (`workspace id`, `attachment slot id`, …). The value is quoted with its
 *  control characters escaped and truncated, because it came from a file
 *  someone else wrote. */
export function unsafePathIdMessage(kind: string, value: unknown): string {
  return (
    `Unsafe ${kind} ${preview(value)}: an id must not be empty or only dots, ` +
    `and must not contain "/", "\\", "%", ":" or control characters.`
  );
}

/** Return `value` when it is a safe path id; throw a descriptive Error
 *  otherwise. Used by every helper that builds a path from an id. */
export function assertSafePathId(value: unknown, kind: string): string {
  if (isSafePathId(value)) return value;
  throw new Error(unsafePathIdMessage(kind, value));
}

function preview(value: unknown): string {
  if (typeof value !== 'string') return `(${typeof value})`;
  return JSON.stringify(
    value.length > PREVIEW_LENGTH ? `${value.slice(0, PREVIEW_LENGTH)}…` : value,
  );
}
