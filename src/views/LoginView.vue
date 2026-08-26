<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import GButton from '@/components/ui/GButton.vue'
import GField from '@/components/ui/GField.vue'
import GLogo from '@/components/ui/GLogo.vue'
import { useAuthStore } from '@/stores/auth'
import { useVideosStore } from '@/stores/videos'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const videos = useVideosStore()

const expired = computed(() => route.query.abgelaufen === '1')

const email = ref('')
const password = ref('')
const staySignedIn = ref(false)

async function onSubmit() {
  const ok = await auth.login(email.value, password.value, staySignedIn.value)
  if (ok) {
    // Mit der Sitzung ändert sich, was der Server herausgibt.
    await videos.reload()
    // Zurück dorthin, wo die Anmeldung abgefangen hat — sonst zur Startseite.
    router.push(auth.anmeldeZielFuer('portal'))
  }
}
</script>

<template>
  <div class="login">
    <section class="hero">
      <div class="brand">
        <GLogo :width="150" :height="52" tone="light" />
        <span class="eyebrow">Videoportal</span>
      </div>

      <div class="pitch">
        <h1>Ihre Inhalte. Ihr Tempo.</h1>
        <p>
          Melden Sie sich an, um die Videos Ihrer gebuchten Pakete freizuschalten — jederzeit,
          auf jedem Gerät.
        </p>
      </div>

      <p class="hint t-meta">Noch keinen Zugang? Zugänge werden derzeit persönlich vergeben.</p>
    </section>

    <section class="pane">
      <form class="form" @submit.prevent="onSubmit">
        <div class="intro">
          <h2 class="t-h2">Anmelden</h2>
          <p class="t-subhead">Zugang zum Videoportal.</p>
        </div>

        <div class="fields">
          <GField
            v-model="email"
            label="E-Mail-Adresse"
            type="email"
            placeholder="name@example.de"
            autocomplete="username"
            required
          />
          <GField
            v-model="password"
            label="Passwort"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
            required
          />
          <label
            class="stay"
            title="Hält die Anmeldung 30 Tage. Ohne Haken endet sie, sobald Sie den Browser schließen."
          >
            <input v-model="staySignedIn" type="checkbox" />
            Angemeldet bleiben
          </label>
        </div>

        <p v-if="expired" class="expired">Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.</p>

        <GButton type="submit" class="submit" :disabled="auth.pending">Anmelden</GButton>

        <p v-if="auth.error" class="error" role="alert">{{ auth.error }}</p>

        <div class="divider" />

        <div class="legal t-meta">
          <a href="#impressum">Impressum</a>
          <a href="#datenschutz">Datenschutz</a>

          <!--
            Zugang zur Verwaltung. Bewusst unauffällig und rechts abgesetzt —
            für Nutzer ohne Belang, für den Betreiber der kürzeste Weg. Der
            Router schickt Unangemeldete ohnehin auf die Backend-Anmeldung.
          -->
          <RouterLink :to="{ name: 'admin-users' }" class="backend">Verwaltung</RouterLink>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  min-height: 100vh;
  background: var(--c-white);
}

/* ── Links: Verlaufs-Hero ──────────────────────────────────────────── */
.hero {
  background: var(--gradient);
  color: var(--c-white);
  padding: 56px 60px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 44px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.eyebrow {
  font-family: var(--font-num);
  font-size: var(--fs-meta);
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-on-dark-eyebrow);
}

.pitch {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
  max-width: 520px;
}

.pitch h1 {
  font-size: var(--fs-display);
  font-weight: 500;
  line-height: 1.08;
}

.pitch p {
  font-size: var(--fs-body);
  line-height: 1.8;
  color: var(--c-on-dark);
}

.hint {
  color: var(--c-on-dark-faint);
}

/* ── Rechts: Formular ──────────────────────────────────────────────── */
.pane {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 44px;
}

.form {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stay {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  color: var(--c-text-dark);
  font-size: var(--fs-body);
}

.stay input {
  width: 17px;
  height: 17px;
  accent-color: var(--c-action);
}

.submit {
  align-self: flex-start;
}

.expired {
  font-size: var(--fs-secondary);
  color: var(--c-orange);
}

.error {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

.divider {
  height: 1px;
  background: var(--c-border);
}

.legal {
  display: flex;
  align-items: center;
  gap: 20px;
}

.legal a {
  color: var(--c-text-muted);
}

/* Rechts abgesetzt, damit es die Rechtstexte nicht verdrängt. */
.backend {
  margin-left: auto;
  padding: 4px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-pill);
  color: var(--c-text-muted);
}

.backend:hover {
  border-color: var(--c-action);
  color: var(--c-action);
  text-decoration: none;
}

/* Unterhalb der Tablet-Breite stapelt der Hero über dem Formular. */
@media (max-width: 900px) {
  .login {
    grid-template-columns: 1fr;
  }

  .hero {
    padding: 40px var(--gutter);
    gap: 32px;
  }

  .pane {
    padding: 40px var(--gutter) 56px;
  }
}
</style>
