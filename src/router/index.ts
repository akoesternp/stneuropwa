import { createRouter, createWebHistory } from 'vue-router'
import AdminShell from '@/layouts/AdminShell.vue'
import AppShell from '@/layouts/AppShell.vue'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/registrieren',
      name: 'registrieren',
      component: () => import('@/views/RegistrierenView.vue'),
      meta: { public: true },
    },
    {
      path: '/admin/login',
      name: 'admin-login',
      component: () => import('@/views/admin/AdminLoginView.vue'),
      meta: { public: true },
    },
    {
      // Die Verwaltung — eigene Rolle mit eigenem Cookie, kein Nutzer-Bereich.
      path: '/admin',
      component: AdminShell,
      meta: { admin: true },
      children: [
        {
          path: '',
          name: 'admin-users',
          component: () => import('@/views/admin/AdminUsersView.vue'),
        },
        {
          path: 'pakete',
          name: 'admin-pakete',
          component: () => import('@/views/admin/AdminPaketeView.vue'),
        },
        {
          path: 'videos',
          name: 'admin-videos',
          component: () => import('@/views/admin/AdminVideosView.vue'),
        },
        {
          path: 'zielgruppen',
          name: 'admin-zielgruppen',
          component: () => import('@/views/admin/AdminZielgruppenView.vue'),
        },
        {
          path: 'bereiche',
          name: 'admin-bereiche',
          component: () => import('@/views/admin/AdminBereicheView.vue'),
        },
        {
          path: 'bestellungen',
          name: 'admin-bestellungen',
          component: () => import('@/views/admin/AdminBestellungenView.vue'),
        },
        {
          path: 'zugaenge',
          name: 'admin-zugaenge',
          component: () => import('@/views/admin/AdminZugaengeView.vue'),
        },
      ],
    },
    {
      /*
       * Die Startseite ist bewusst öffentlich: Besucher sehen die freien
       * Kacheln, Angemeldete zusätzlich die ihrer Pakete. Was sichtbar ist,
       * entscheidet der Server — nicht diese Route.
       */
      path: '/',
      component: AppShell,
      meta: { public: true },
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('@/views/HomeView.vue'),
          meta: { public: true },
        },
        {
          // Die flache Liste aller Übungen — zum Suchen statt zum Stöbern.
          path: 'videos',
          name: 'videos',
          component: () => import('@/views/VideoListeView.vue'),
          meta: { public: true },
        },
        {
          /*
           * Preisliste und Staffel — auch ohne Anmeldung: was etwas kostet,
           * will man wissen, bevor man ein Konto anlegt.
           */
          path: 'credits',
          name: 'credits',
          component: () => import('@/views/CreditsView.vue'),
          meta: { public: true },
        },
        {
          /*
           * Ebenfalls öffentlich: ob dieses Video abspielbar ist, entscheidet
           * der Stream-Endpunkt am Cookie — ein Unberechtigter sieht hier nur
           * die Fehlermeldung, nie den Inhalt.
           */
          path: 'videos/:id',
          name: 'video',
          component: () => import('@/views/VideoView.vue'),
          meta: { public: true },
        },
        {
          /*
           * Die Paketübersicht steht auf der Startseite; nur die Einzelansicht
           * hat noch eine eigene Adresse. Ein Lesezeichen auf /pakete landet
           * über den Auffangpfad wieder auf der Startseite — dort steht die
           * Übersicht ja.
           *
           * Das Angebot darf jeder sehen: Titel und Laufzeiten sind die
           * Beschreibung eines Pakets, nicht sein Inhalt.
           */
          path: 'pakete/:id',
          name: 'paket',
          component: () => import('@/views/PaketDetailView.vue'),
          meta: { public: true },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  const needsAdmin = to.matched.some((record) => record.meta.admin)

  if (needsAdmin) {
    // Das Ziel merkt sich der Store — nicht als ?redirect=… in der Adresse.
    if (!auth.isAdmin) {
      auth.merkeAnmeldeZiel(to.fullPath)
      return { name: 'admin-login' }
    }
    return true
  }

  if (!to.meta.public && !auth.isAuthenticated) {
    auth.merkeAnmeldeZiel(to.fullPath)
    return { name: 'login' }
  }

  // Wer schon angemeldet ist, hat auf einer Anmeldeseite nichts verloren.
  if ((to.name === 'login' || to.name === 'registrieren') && auth.isAuthenticated) {
    return { name: 'home' }
  }
  if (to.name === 'admin-login' && auth.isAdmin) return { name: 'admin-users' }

  return true
})

/**
 * Ein fehlgeschlagener Nachlade-Import darf keine tote Oberfläche hinterlassen.
 *
 * Die Ansichten werden einzeln nachgeladen. Zeigt ein zwischengespeichertes
 * index.html noch auf Dateinamen einer älteren Fassung (typisch nach einem
 * Deploy, wenn der Service Worker den alten Stand hält), scheitert dieser
 * Import — der Router bricht die Navigation dann still ab, und ein Klick auf
 * den Reiter tut scheinbar gar nichts.
 *
 * Statt dessen wird die Seite einmal richtig geladen; damit holt der Browser
 * index.html samt der dazu passenden Dateinamen neu.
 */
const NEULADEN_SCHLUESSEL = 'stneuro.nachladen-gescheitert'

function merker(): Storage | null {
  // Im privaten Modus kann schon der Zugriff werfen.
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

router.onError((fehler, ziel) => {
  const meldung = String((fehler as Error)?.message ?? '')
  const nachladenGescheitert =
    /dynamically imported module|Importing a module script failed|Unable to preload/i.test(meldung)

  if (!nachladenGescheitert) return

  // Nur einmal je Ziel — fehlt die Datei wirklich, drehte sich die Seite sonst
  // endlos im Kreis.
  const speicher = merker()
  if (speicher?.getItem(NEULADEN_SCHLUESSEL) === ziel.fullPath) return
  speicher?.setItem(NEULADEN_SCHLUESSEL, ziel.fullPath)

  window.location.assign(ziel.fullPath)
})

// Hat es geklappt, darf ein späterer Fehlschlag wieder neu laden dürfen.
router.afterEach(() => {
  merker()?.removeItem(NEULADEN_SCHLUESSEL)
})

export default router
