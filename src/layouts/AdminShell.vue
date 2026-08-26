<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import GButton from '@/components/ui/GButton.vue'
import GLogo from '@/components/ui/GLogo.vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const nav = [
  { label: 'Nutzer', name: 'admin-users' },
  { label: 'Pakete', name: 'admin-pakete' },
  { label: 'Videos', name: 'admin-videos' },
  { label: 'Zugänge', name: 'admin-zugaenge' },
] as const

interface Health {
  benutzer: number
  pakete: number
  videos: number
  admins: number
  defaultPasswordAdmins: string[]
}

const health = ref<Health | null>(null)

onMounted(async () => {
  health.value = await api.get<Health>('/admin/health').catch(() => null)
})

async function logout() {
  await auth.logoutAdmin()
  router.push({ name: 'admin-login' })
}
</script>

<template>
  <div class="shell">
    <header class="header">
      <div class="inner">
        <div class="brand">
          <GLogo :width="115" :height="40" tone="light" />
          <span class="eyebrow">Verwaltung</span>
        </div>

        <nav class="nav" aria-label="Verwaltungs-Navigation">
          <RouterLink v-for="item in nav" :key="item.name" :to="{ name: item.name }" class="item">
            {{ item.label }}
          </RouterLink>
        </nav>

        <div class="right">
          <span class="who t-meta">{{ auth.adminName || auth.adminUser }}</span>
          <GButton variant="white" size="sm" @click="logout">Abmelden</GButton>
        </div>
      </div>
    </header>

    <!--
      Das Standardpasswort steht in der Anleitung — solange es gilt, kommt
      jeder herein, der die Anleitung kennt. Deshalb steht der Hinweis über
      jeder Seite und verschwindet erst mit der Änderung.
    -->
    <p v-if="health?.defaultPasswordAdmins?.length" class="warn" role="alert">
      {{ health.defaultPasswordAdmins.join(', ') }} nutzt noch das Standardpasswort der
      Ersteinrichtung.
      <RouterLink :to="{ name: 'admin-zugaenge' }" class="warn-link">Jetzt ändern</RouterLink>
    </p>

    <main class="main">
      <RouterView />
    </main>

    <footer class="footer t-meta">
      <span>{{ health?.benutzer ?? '–' }} Nutzer</span>
      <span>{{ health?.pakete ?? '–' }} Pakete</span>
      <span>{{ health?.videos ?? '–' }} Videos</span>
      <RouterLink :to="{ name: 'home' }">Zum Portal</RouterLink>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--c-page);
}

.header {
  background: var(--c-dark);
  position: sticky;
  top: 0;
  z-index: 8;
}

.inner {
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 16px var(--gutter);
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.eyebrow {
  font-family: var(--font-num);
  font-size: var(--fs-meta);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-on-dark-eyebrow);
}

.nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border-radius: var(--r-nav);
  background: rgba(255, 255, 255, 0.08);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.nav::-webkit-scrollbar {
  display: none;
}

.item {
  padding: 10px 20px;
  border-radius: var(--r-nav);
  font-size: var(--fs-secondary);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  color: var(--c-on-dark);
}

.item:hover,
.item.router-link-exact-active {
  background: var(--c-white);
  color: var(--c-dark);
  text-decoration: none;
}

.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
}

.who {
  color: var(--c-on-dark-faint);
}

.warn {
  max-width: var(--max-w);
  width: 100%;
  margin: 20px auto 0;
  padding: 14px 22px;
  border-radius: var(--r-card);
  background: var(--c-orange);
  color: var(--c-white);
  font-size: var(--fs-secondary);
}

.warn-link {
  color: var(--c-white);
  text-decoration: underline;
  margin-left: 6px;
}

.main {
  flex: 1;
  width: 100%;
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 32px var(--gutter) 64px;
}

.footer {
  max-width: var(--max-w);
  width: 100%;
  margin: 0 auto;
  padding: 0 var(--gutter) 28px;
  display: flex;
  gap: 24px;
}
</style>
