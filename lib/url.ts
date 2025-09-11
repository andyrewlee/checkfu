export function revokeIfBlob(url?: string | null) {
  try {
    if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
  } catch {
    // ignore — revoking an already-revoked or invalid URL is safe to skip
  }
}
