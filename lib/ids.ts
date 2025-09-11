export function newId(prefix = ""): string {
  const core =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return prefix ? `${prefix}_${core}` : core;
}
