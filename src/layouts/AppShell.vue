<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router'
import GButton from '@/components/ui/GButton.vue'
import GLogo from '@/components/ui/GLogo.vue'
import { useAuthStore } from '@/stores/auth'
import { useFortschrittStore } from '@/stores/fortschritt'
import { useVideosStore } from '@/stores/videos'

const router = useRouter()
const auth = useAuthStore()
const videos = useVideosStore()
const fortschritt = useFortschrittStore()

/**
 * Nach der Abmeldung entscheidet wieder der Server, was sichtbar ist —
 * deshalb die Kacheln neu laden, statt lokal etwas auszublenden.
 */
async function logout() {
  await auth.logout()
  fortschritt.verwerfen()
  await videos.reload()
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="shell">
    <header class="header">
      <div class="header-inner">
        <RouterLink :to="{ name: 'home' }" class="logo-link" aria-label="Zur Startseite">
          <GLogo :width="127" :height="44" />
        </RouterLink>

        <nav class="nav" aria-label="Hauptnavigation">
          <RouterLink :to="{ name: 'home' }" class="nav-item">Übersicht</RouterLink>
          <RouterLink :to="{ name: 'videos' }" class="nav-item">Alle Übungen</RouterLink>
          <!-- Auch für Gäste: was etwas kostet, will man vor dem Konto wissen. -->
          <RouterLink :to="{ name: 'credits' }" class="nav-item">Credits</RouterLink>
        </nav>

        <div class="tools">
          <template v-if="auth.isAuthenticated">
            <span class="account-chip">
              <span class="avatar" aria-hidden="true">{{ auth.initials }}</span>
              <span class="account-label">
                <span class="who">{{ auth.user?.name || auth.user?.email }}</span>
                <span class="t-meta">{{
                  auth.user?.pakete.length
                    ? auth.user!.pakete.join(' · ')
                    : 'Keine Pakete zugewiesen'
                }}</span>
              </span>
            </span>

            <!--
              Das Guthaben gehört neben den Namen: es entscheidet an jeder
              gesperrten Kachel darüber, ob die Schaltfläche dort etwas nützt.
              Als Verweis, weil die nächste Frage danach immer „wie bekomme ich
              mehr davon" lautet.
            -->
            <RouterLink
              class="guthaben"
              :to="{ name: 'credits' }"
              title="Guthaben — hier nachkaufen"
            >
              <span class="guthaben-zahl">{{ auth.user?.credits ?? 0 }}</span>
              <span class="t-meta">{{
                (auth.user?.credits ?? 0) === 1 ? 'Credit' : 'Credits'
              }}</span>
            </RouterLink>
            <GButton variant="outline" size="sm" @click="logout">Abmelden</GButton>
          </template>

          <template v-else>
            <GButton variant="outline" size="sm" :to="{ name: 'registrieren' }">
              Registrieren
            </GButton>
            <GButton variant="dark" size="sm" :to="{ name: 'login' }">Anmelden</GButton>
          </template>
        </div>
      </div>
    </header>

    <main class="main">
      <RouterView />
    </main>

    <footer class="footer">
      <div class="footer-inner t-meta">
        <span>© 2026 stneuro</span>
        <div class="footer-links">
          <a href="#datenschutz">Datenschutz</a>
          <a href="#impressum">Impressum</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Kopfzeile ─────────────────────────────────────────────────────── */
.header {
  position: sticky;
  top: 0;
  z-index: 8;
  background: var(--c-white);
  border-bottom: 1px solid var(--c-hairline-2);
}

.header-inner {
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 18px var(--gutter);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.logo-link {
  flex: none;
  display: block;
  line-height: 0;
}

.logo-link:hover {
  text-decoration: none;
}

.nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: var(--r-nav);
  background: var(--c-tint);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.nav::-webkit-scrollbar {
  display: none;
}

.nav-item {
  padding: 10px 22px;
  border-radius: var(--r-nav);
  font-size: var(--fs-secondary);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  color: var(--c-text);
}

/*
 * `exact-active` an der Startseite, sonst leuchtete sie bei jedem Unterpfad
 * mit — sie ist die Wurzel aller Portal-Routen.
 */
.nav-item:hover,
.nav-item.router-link-active:not([href='/']),
.nav-item.router-link-exact-active {
  background: var(--c-dark);
  color: var(--c-white);
  text-decoration: none;
}

.tools {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  margin-left: auto;
}

/*
 * `account-chip`, nicht `account`: das Wurzelelement einer gerouteten View
 * erbt die Scope-ID dieser Komponente — Shell-Klassennamen müssen sich von
 * denen unterscheiden, die Views auf ihrem Wurzelelement nutzen.
 */
.account-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px 6px 6px;
  border-radius: var(--r-nav);
  background: var(--c-surface);
  min-width: 0;
}

.avatar {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 50%;
  background: var(--c-dark);
  color: var(--c-white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-secondary);
  font-weight: 500;
}

.account-label {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
  min-width: 0;
}

.who {
  font-size: var(--fs-secondary);
  font-weight: 500;
}

/* Dunkel abgesetzt: das Guthaben ist eine Zahl, die sich ändert — sie soll
   auffallen, wenn sie es tut. */
.guthaben {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: none;
  padding: 7px 14px;
  border-radius: var(--r-nav);
  background: var(--c-dark);
  color: var(--c-on-dark);
}

.guthaben:hover {
  color: var(--c-white);
  text-decoration: none;
  filter: brightness(1.25);
}

.guthaben-zahl {
  font-size: var(--fs-secondary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ── Inhalt / Fußzeile ─────────────────────────────────────────────── */
.main {
  flex: 1;
  width: 100%;
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 36px var(--gutter) 72px;
}

.footer {
  background: var(--c-dark);
  color: var(--c-on-dark-faint);
  padding: 28px var(--gutter);
}

.footer-inner {
  max-width: var(--max-w);
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  color: var(--c-on-dark-faint);
}

.footer-links {
  display: flex;
  gap: 24px;
}

.footer-links a {
  color: var(--c-on-dark-faint);
}

.footer-links a:hover {
  color: var(--c-white);
}
</style>
