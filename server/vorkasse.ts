/**
 * Die Bankverbindung für Vorkasse.
 *
 * Aus der Umgebung wie jede andere Einstellung — Kontodaten gehören nicht ins
 * Git. Fehlt die IBAN, ist der Zahlweg schlicht aus: eine Überweisungsmaske
 * ohne Empfänger wäre schlimmer als gar keine.
 *
 * Die Angaben sind öffentlich in dem Sinn, dass jeder angemeldete Besteller
 * sie sieht — das müssen sie sein, sonst kann niemand überweisen.
 */
const IBAN = (process.env.VORKASSE_IBAN ?? '').replace(/\s+/g, '').toUpperCase()

export const VORKASSE = {
  aktiv: IBAN !== '',
  empfaenger: process.env.VORKASSE_EMPFAENGER ?? '',
  /** In Vierergruppen, so wie man sie abliest und abtippt. */
  iban: IBAN.replace(/(.{4})/g, '$1 ').trim(),
  bic: process.env.VORKASSE_BIC ?? '',
  bank: process.env.VORKASSE_BANK ?? '',
  /**
   * Wie lange die Freischaltung dauert. Ehrlich benannt: bei Vorkasse liegt
   * zwischen Bestellung und Guthaben ein Banklauf und ein Mensch.
   */
  dauer: process.env.VORKASSE_DAUER ?? '1–3 Werktage nach Zahlungseingang',
} as const
