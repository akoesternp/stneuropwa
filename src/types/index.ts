export type { Benutzer, BenutzerEintrag, Paket, PaketInhalt, Video } from '@shared/types'

/** Spaltendefinition der DataTable. */
export interface Column {
  label?: string
  /** CSS-Grid-Breite, z. B. '1fr', '160px' oder 'minmax(160px,1fr)'. */
  width: string
  align?: 'left' | 'right'
}
