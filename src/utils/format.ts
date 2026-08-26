/**
 * Zwei Buchstaben fürs Avatar-Kürzel: "Max Muster" → "MM".
 * Wörter, die nicht mit Buchstabe oder Ziffer beginnen, werden übersprungen.
 */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word))

  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}
