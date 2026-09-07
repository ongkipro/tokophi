// Initials from a person or store name: "Batik Nusantara" → "BN", "Ongki" → "O", "" → "".
// The first letter of the first two words, so an <AvatarFallback> is derived from the tenant's
// own name instead of a hard-coded demo string (page-map finding AD-3: every store's Pengaturan
// read "BN"). One copy for apps/admin — super-admin keeps its own in components/bits.tsx.
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
