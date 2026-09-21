/** Some browsers read a download's URL a moment after the click that starts it. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Hands a file to the browser to save, as a download.
 *
 * The link is put inside `container`, the open dialog: a modal dialog makes the
 * rest of the page inert.
 */
export function saveFile(blob: Blob, filename: string, container: HTMLElement): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;

  container.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
