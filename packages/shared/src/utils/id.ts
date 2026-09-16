/** `crypto.randomUUID` is available in Node >=19 and every browser this app targets. */
export function createId(): string {
  return globalThis.crypto.randomUUID();
}
