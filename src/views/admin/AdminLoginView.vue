<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import GButton from '@/components/ui/GButton.vue'
import GField from '@/components/ui/GField.vue'
import GLogo from '@/components/ui/GLogo.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const expired = computed(() => route.query.abgelaufen === '1')

const user = ref('')
const password = ref('')

async function onSubmit() {
  if (await auth.loginAdmin(user.value, password.value)) {
    // Zurück dorthin, wo die Anmeldung abgefangen hat — sonst zur Nutzerliste.
    router.push(auth.anmeldeZielFuer('backend'))
  }
}
</script>

<template>
  <div class="login">
    <form class="panel" @submit.prevent="onSubmit">
      <div class="brand">
        <GLogo :width="132" :height="52" tone="light" />
        <span class="eyebrow">Verwaltung</span>
      </div>

      <div class="intro">
        <h1 class="t-h2">Anmelden</h1>
        <p class="sub">Zugang für die Verwaltung.</p>
      </div>

      <GField v-model="user" label="Benutzer" autocomplete="username" required />
      <GField
        v-model="password"
        label="Passwort"
        type="password"
        autocomplete="current-password"
        required
      />

      <p v-if="expired" class="hint">
        Ihre Sitzung ist abgelaufen — das passiert auch, wenn der Server neu gestartet wurde.
        Bitte erneut anmelden.
      </p>

      <GButton type="submit" variant="white" :disabled="auth.pending">Anmelden</GButton>

      <p v-if="auth.error" class="error" role="alert">{{ auth.error }}</p>
    </form>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: var(--gradient);
}

.panel {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: var(--c-white);
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.eyebrow {
  font-family: var(--font-num);
  font-size: var(--fs-meta);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-on-dark-eyebrow);
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.sub {
  font-size: var(--fs-body);
  color: var(--c-on-dark);
}

/* Die Felder liegen auf dem Verlauf, also invertieren ihre Labels. */
.panel :deep(.t-eyebrow) {
  color: var(--c-on-dark-eyebrow);
}

.hint {
  font-size: var(--fs-secondary);
  color: var(--c-white);
  background: rgba(255, 255, 255, 0.16);
  padding: 10px 16px;
  border-radius: var(--r-card);
}

.error {
  font-size: var(--fs-secondary);
  color: var(--c-white);
  background: var(--c-red);
  padding: 10px 16px;
  border-radius: var(--r-card);
}
</style>
