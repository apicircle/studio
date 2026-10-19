/**
 * Hand `contents` to the browser as a file download named `filename`. Returns
 * false, having done nothing, where the page has no way to start one (a
 * non-browser test environment without `URL.createObjectURL`).
 *
 * The object URL is released on the next microtask, once the click has started
 * the download, so the blob is not collected out from under it.
 */
export function downloadTextFile(filename: string, contents: string, type = 'text/plain'): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  queueMicrotask(() => URL.revokeObjectURL(url));
  return true;
}
