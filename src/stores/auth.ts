import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api, ApiError } from '@/api/client'
import { initials as toInitials } from '@/utils/format'
import type { Benutzer } from '@/types'

/**
 * Beide Rollen laufen unabhängig voneinander.
 *
 * Server und Browser halten je ein eigenes Cookie — man kann gleichzeitig als
 * Nutzer und im Backend angemeldet sein, und eine Abmeldung betrifft nur die
 * jeweilige Rolle.
 *
 * Die Sitzungen leben in einem httpOnly-Cookie, das der Server setzt; die
 * Oberfläche speichert selbst nichts. `restore()` wird in main.ts vor dem
 * Einhängen abgewartet, damit der Router-Guard synchron bleiben kann.
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<Benutzer | null>(null)
  const adminUser = ref<string | null>(null)
  /** Klarname des Backend-Zugangs — im Kopf aussagekräftiger als der Anmeldename. */
  const adminName = ref<string | null>(null)
  const pending = ref(false)
  const error = ref<string | null>(null)
  const restored = ref(false)

  /**
   * Wohin nach der Anmeldung? Wird vom Router-Guard gemerkt statt als
   * `?redirect=…` in die Adresse geschrieben — die Anmeldeseite behält damit
   * eine saubere URL, und das Ziel landet nie in Verlauf oder Lesezeichen.
   */
  let anmeldeZiel: string | null = null

  function merkeAnmeldeZiel(pfad: string): void {
    anmeldeZiel = pfad
  }

  /**
   * Holt das gemerkte Ziel ab (einmalig) und prüft, dass es in den richtigen
   * Bereich führt — eine Nutzer-Anmeldung darf nie im Backend landen und
   * umgekehrt. Ohne brauchbares Ziel: die Startseite des Bereichs.
   */
  function anmeldeZielFuer(bereich: 'portal' | 'backend'): string {
    const gemerkt = anmeldeZiel
    anmeldeZiel = null

    const start = bereich === 'backend' ? '/admin' : '/'
    if (!gemerkt || !gemerkt.startsWith('/')) return start
    if ((bereich === 'backend') !== gemerkt.startsWith('/admin')) return start
    return gemerkt
  }

  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => adminUser.value !== null)
  const initials = computed(() =>
    user.value ? toInitials(user.value.name || user.value.email) : '',
  )

  async function restore(): Promise<void> {
    try {
      const me = await api.get<{
        user: Benutzer | null
        admin: string | null
        adminName: string | null
      }>('/auth/me')
      user.value = me.user
      adminUser.value = me.admin
      adminName.value = me.adminName
    } catch {
      // Erreicht der Aufruf den Server nicht, gilt beides als abgemeldet.
      user.value = null
      adminUser.value = null
      adminName.value = null
    } finally {
      restored.value = true
    }
  }

  /**
   * `remember` entscheidet nur der Server: gesetzt hält die Anmeldung 30 Tage,
   * sonst endet sie mit dem Browserfenster. Die Oberfläche merkt sich nichts.
   */
  async function login(email: string, password: string, remember = false): Promise<boolean> {
    pending.value = true
    error.value = null
    try {
      const result = await api.post<{ user: Benutzer }>('/auth/login', {
        email,
        password,
        remember,
      })
      user.value = result.user
      return true
    } catch (cause) {
      error.value =
        cause instanceof ApiError
          ? cause.message
          : 'Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.'
      return false
    } finally {
      pending.value = false
    }
  }

  /**
   * Selbstregistrierung. Der Server legt das Konto an und meldet gleich an —
   * ein Formular, nach dem man sich noch einmal anmelden muss, wäre eine
   * überflüssige Hürde.
   */
  async function registrieren(
    email: string,
    passwort: string,
    name: string,
  ): Promise<boolean> {
    pending.value = true
    error.value = null
    try {
      const result = await api.post<{ user: Benutzer }>('/auth/registrieren', {
        email,
        passwort,
        name,
      })
      user.value = result.user
      return true
    } catch (cause) {
      error.value =
        cause instanceof ApiError
          ? cause.message
          : 'Registrierung derzeit nicht möglich. Bitte später erneut versuchen.'
      return false
    } finally {
      pending.value = false
    }
  }

  async function loginAdmin(benutzer: string, password: string): Promise<boolean> {
    pending.value = true
    error.value = null
    try {
      const result = await api.post<{ user: string; name: string }>('/auth/admin/login', {
        user: benutzer,
        password,
      })
      adminUser.value = result.user
      adminName.value = result.name
      return true
    } catch (cause) {
      error.value =
        cause instanceof ApiError
          ? cause.message
          : 'Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.'
      return false
    } finally {
      pending.value = false
    }
  }

  /** Verwirft nur den lokalen Stand — falls der Server die Sitzung bereits abgelehnt hat. */
  function resetUser(): void {
    user.value = null
  }

  function resetAdmin(): void {
    adminUser.value = null
    adminName.value = null
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      resetUser()
    }
  }

  async function logoutAdmin(): Promise<void> {
    try {
      await api.post('/auth/admin/logout')
    } finally {
      resetAdmin()
    }
  }

  return {
    user,
    adminUser,
    adminName,
    pending,
    error,
    restored,
    isAuthenticated,
    isAdmin,
    initials,
    merkeAnmeldeZiel,
    anmeldeZielFuer,
    restore,
    login,
    registrieren,
    loginAdmin,
    logout,
    logoutAdmin,
    resetUser,
    resetAdmin,
  }
})
