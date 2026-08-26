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
          // Das Angebot darf jeder sehen: Titel und Laufzeiten sind die
          // Beschreibung eines Pakets, nicht sein Inhalt.
          path: 'pakete',
          name: 'pakete',
          component: () => import('@/views/PaketeView.vue'),
          meta: { public: true },
        },
        {
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
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'home' }
  if (to.name === 'admin-login' && auth.isAdmin) return { name: 'admin-users' }

  return true
})

export default router
