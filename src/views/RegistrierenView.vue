<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import NeuroWert from '@/components/NeuroWert.vue'
import GButton from '@/components/ui/GButton.vue'
import GField from '@/components/ui/GField.vue'
import GLogo from '@/components/ui/GLogo.vue'
import { useAuthStore } from '@/stores/auth'
import { useFortschrittStore } from '@/stores/fortschritt'
import { useVideosStore } from '@/stores/videos'
import { api } from '@/api/client'
import type { StartguthabenInfo } from '@/types'

/**
 * Selbstregistrierung.
 *
 * Ein neues Konto bekommt bewusst nichts zugeordnet — es sieht zunächst genau
 * das, was auch ohne Anmeldung sichtbar ist. Das steht auch so im Formular:
 * eine Anmeldung, nach der scheinbar nichts passiert, wäre sonst eine
 * Enttäuschung.
 */
const router = useRouter()
const auth = useAuthStore()
const videos = useVideosStore()
const fortschritt = useFortschrittStore()

/** Muss zum Server passen (MIN_PASSWORT_LAENGE in routes/auth.ts). */
const MIN_LAENGE = 8

const name = ref('')
const email = ref('')
const passwort = ref('')
const wiederholung = ref('')
const fehler = ref<string | null>(null)

/**
 * Was ein neues Konto bekommt — inklusive laufender Aktion.
 *
 * Wird vor dem Absenden angezeigt, denn genau dafür ist eine Aktion da: ein
 * Guthaben, das erst hinterher auftaucht, wirbt nicht. Verbindlich ist es
 * trotzdem nicht — zwischen Anzeige und Klick kann das Fenster zugehen oder
 * der Deckel fallen. Deshalb meldet die Bestätigung unten den TATSÄCHLICH
 * gebuchten Betrag.
 */
const startguthaben = ref<StartguthabenInfo | null>(null)

onMounted(async () => {
  try {
    startguthaben.value = await api.get<StartguthabenInfo>('/portal/startguthaben')
  } catch {
    // Ohne diese Auskunft fehlt nur der Hinweis, nicht das Formular.
    startguthaben.value = null
  }
})

const geschenk = computed(
  () => startguthaben.value?.aktion?.credits ?? startguthaben.value?.grundguthaben ?? 0,
)

const zuKurz = computed(() => passwort.value.length > 0 && passwort.value.length < MIN_LAENGE)
const ungleich = computed(
  () => wiederholung.value.length > 0 && passwort.value !== wiederholung.value,
)

async function onSubmit() {
  fehler.value = null

  // Tippfehler im verdeckten Feld fielen sonst erst bei der nächsten Anmeldung auf.
  if (passwort.value !== wiederholung.value) {
    fehler.value = 'Die beiden Passwörter stimmen nicht überein.'
    return
  }

  const ok = await auth.registrieren(email.value, passwort.value, name.value)
  if (!ok) {
    fehler.value = auth.error
    return
  }

  // Mit der Sitzung ändert sich, was der Server herausgibt.
  await Promise.all([videos.reload(), fortschritt.reload()])
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="seite">
    <section class="hero">
      <div class="brand">
        <GLogo :width="150" :height="52" tone="light" />
        <span class="eyebrow">Videoportal</span>
      </div>

      <div class="pitch">
        <h1>Konto anlegen</h1>
        <p>
          Mit einem eigenen Konto merkt sich das Portal, welche Übungen Sie schon gemacht haben
          und wo Sie stehengeblieben sind.
        </p>
      </div>

      <!--
        Das Startguthaben gehört auf die Werbeseite, nicht ins Kleingedruckte:
        es ist der greifbarste Grund, das Formular auszufüllen.
      -->
      <div v-if="geschenk > 0" class="geschenk">
        <NeuroWert class="geschenk-wert" :betrag="geschenk" wort />
        <span class="geschenk-text">
          {{
            startguthaben?.aktion
              ? `geschenkt — Aktion „${startguthaben.aktion.name}"`
              : 'zum Start geschenkt'
          }}
        </span>
      </div>

      <p class="hint t-meta">
        Zunächst sind die frei verfügbaren Übungen zugänglich<template v-if="geschenk > 0">;
        mit Ihrem Startguthaben schalten Sie weitere frei</template>.
      </p>
    </section>

    <section class="pane">
      <form class="form" @submit.prevent="onSubmit">
        <div class="intro">
          <h2 class="t-h2">Registrieren</h2>
          <p class="t-subhead">Ein paar Angaben genügen.</p>
        </div>

        <div class="fields">
          <GField v-model="name" label="Name (optional)" autocomplete="name" />
          <GField
            v-model="email"
            label="E-Mail-Adresse"
            type="email"
            placeholder="name@example.de"
            autocomplete="username"
            required
          />
          <GField
            v-model="passwort"
            label="Passwort"
            type="password"
            :placeholder="`mindestens ${MIN_LAENGE} Zeichen`"
            autocomplete="new-password"
            required
          />
          <p v-if="zuKurz" class="feldhinweis">
            Noch zu kurz — mindestens {{ MIN_LAENGE }} Zeichen.
          </p>

          <GField
            v-model="wiederholung"
            label="Passwort wiederholen"
            type="password"
            autocomplete="new-password"
            required
          />
          <p v-if="ungleich" class="feldhinweis">Die beiden Passwörter stimmen noch nicht überein.</p>
        </div>

        <GButton type="submit" class="submit" :disabled="auth.pending">Konto anlegen</GButton>

        <p v-if="fehler" class="error" role="alert">{{ fehler }}</p>

        <div class="divider" />

        <p class="t-subhead">
          Schon ein Konto? <RouterLink :to="{ name: 'login' }">Zur Anmeldung</RouterLink>
        </p>

        <!--
          Der Weg am Formular vorbei. Ein Konto bringt Fortschritt und
          Freischaltungen, ist aber keine Bedingung fürs Zuschauen — wer erst
          stöbern will, soll das nicht erst herausfinden müssen.
        -->
        <RouterLink :to="{ name: 'home' }" class="weiter">
          Ohne Anmeldung fortfahren →
        </RouterLink>

        <div class="legal t-meta">
          <RouterLink :to="{ name: 'impressum' }">Impressum</RouterLink>
          <RouterLink :to="{ name: 'datenschutz' }">Datenschutz</RouterLink>
          <RouterLink :to="{ name: 'widerruf' }">Widerruf</RouterLink>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.seite {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  min-height: 100vh;
  background: var(--c-white);
}

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
  max-width: 46ch;
}

/* Auf dem Verlauf abgesetzt: die Zahl soll das Erste sein, was auffällt. */
.geschenk {
  display: flex;
  align-items: center;
  gap: 14px;
  align-self: flex-start;
  padding: 14px 22px;
  border: 1px solid var(--c-on-dark-faint);
  border-radius: var(--r-card);
  color: var(--c-white);
}

.geschenk-wert {
  font-size: var(--fs-stat);
  font-weight: 600;
  line-height: 1.1;
}

.geschenk-text {
  font-size: var(--fs-secondary);
  line-height: 1.4;
  color: var(--c-on-dark);
  max-width: 22ch;
}

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

/* Hinweis direkt am Feld statt erst nach dem Absenden. */
.feldhinweis {
  margin-top: -8px;
  font-size: var(--fs-secondary);
  color: var(--c-orange);
}

.submit {
  align-self: flex-start;
}

.error {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

.divider {
  height: 1px;
  background: var(--c-border);
}

/*
 * Der Weg am Formular vorbei — sichtbar, aber ruhiger als der Anmeldeknopf:
 * er ist die Nebentür, nicht der Haupteingang.
 */
.weiter {
  align-self: flex-start;
  padding: 9px 20px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-pill);
  font-size: var(--fs-secondary);
  font-weight: 500;
  color: var(--c-text-dark);
}

.weiter:hover {
  border-color: var(--c-action);
  color: var(--c-action);
  text-decoration: none;
}

.legal {
  display: flex;
  align-items: center;
  gap: 20px;
}

.legal a {
  color: var(--c-text-muted);
}

@media (max-width: 900px) {
  .seite {
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
