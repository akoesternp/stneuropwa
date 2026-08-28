export type {
  Benutzer,
  BenutzerEintrag,
  KatalogVideo,
  Paket,
  PaketInhalt,
  Video,
} from '@shared/types'

/**
 * Filter nach dem eigenen Zugang: '' = alle, sonst nur freigeschaltete bzw.
 * nur gesperrte Übungen.
 */
export type Zugangsfilter = '' | 'frei' | 'gesperrt'

/** Spaltendefinition der DataTable. */
export interface Column {
  label?: string
  /** CSS-Grid-Breite, z. B. '1fr', '160px' oder 'minmax(160px,1fr)'. */
  width: string
  align?: 'left' | 'right'
}
