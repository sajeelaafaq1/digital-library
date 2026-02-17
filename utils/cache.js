export const libraryCache = {
  data: null,
  expiresAt: 0,
  ttlMs: 7 * 24 * 60 * 60 * 1000 // 1 week
};

export function invalidateLibraryCache() {
  libraryCache.data = null;
  libraryCache.expiresAt = 0;
}