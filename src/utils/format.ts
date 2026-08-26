/**
 * "12:30" → 750, "1:02:30" → 3750. Null, wenn der Text dem Muster nicht folgt
 * — die Dauer ist ein Anzeigefeld und darf auch „ca. 12 Min" enthalten.
 */
export function dauerInSekunden(text: string): number | null {
  const teile = text.trim().split(':')
  if (teile.length < 2 || teile.length > 3) return null

  const zahlen = teile.map((teil) => Number(teil))
  if (zahlen.some((zahl) => !Number.isInteger(zahl) || zahl < 0)) return null

  return teile.length === 3
    ? zahlen[0]! * 3600 + zahlen[1]! * 60 + zahlen[2]!
    : zahlen[0]! * 60 + zahlen[1]!
}

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
