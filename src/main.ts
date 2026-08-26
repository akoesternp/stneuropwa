import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './api/client'
import { useAuthStore } from './stores/auth'
import '@/assets/styles/base.css'

const app = createApp(App).use(createPinia())
const auth = useAuthStore()

/*
 * Eine Sitzung kann serverseitig enden (Zeitablauf, gelöschter Zugang),
 * während der Browser noch angemeldet aussieht. Statt die nächste Aktion mit
 * einem nackten „Nicht angemeldet" scheitern zu lassen: lokalen Stand
 * verwerfen und zur passenden Anmeldeseite.
 *
 * Welche Rolle betroffen ist, ergibt sich aus der aktuellen Route, nicht aus
 * dem Store: beide Rollen können gleichzeitig angemeldet sein, und nur eine
 * davon ist gerade gescheitert.
 */
setUnauthorizedHandler(() => {
  const name = String(router.currentRoute.value.name ?? '')
  const inBackend = name.startsWith('admin')

  if (inBackend) {
    auth.resetAdmin()
    if (name !== 'admin-login') {
      // Nach erneuter Anmeldung geht es dort weiter, wo die Sitzung ablief.
      auth.merkeAnmeldeZiel(router.currentRoute.value.fullPath)
      void router.push({ name: 'admin-login', query: { abgelaufen: '1' } })
    }
    return
  }

  auth.resetUser()
  if (name !== 'login') {
    auth.merkeAnmeldeZiel(router.currentRoute.value.fullPath)
    void router.push({ name: 'login', query: { abgelaufen: '1' } })
  }
})

/*
 * Die Cookie-Sitzungen VOR dem Einhängen wiederherstellen, damit der
 * Router-Guard synchron bleiben kann, statt dass jede Route gegen ein
 * laufendes /auth/me anrennt.
 *
 * Bewusst eine .finally()-Kette und kein Top-Level-await: das erzwänge ein
 * ES2022-Bundle-Ziel und würde ältere Browser still aussperren. `restore()`
 * schluckt eigene Fehler — ein gescheiterter Aufruf hängt trotzdem ein, als
 * abgemeldet.
 */
auth.restore().finally(() => {
  app.use(router).mount('#app')
})
