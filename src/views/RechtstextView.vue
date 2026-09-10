<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import GButton from '@/components/ui/GButton.vue'
import { useKontaktStore } from '@/stores/kontakt'

/**
 * Impressum, Datenschutz und Widerrufsbelehrung — vorerst als Platzhalter.
 *
 * Bewusst EINE Ansicht für alle drei: der Inhalt fehlt überall gleichermaßen,
 * und drei Dateien mit demselben „hier steht noch nichts" wären drei Stellen,
 * die man beim Nachtragen übersieht. Was die Seite sagt, steht in der Route.
 *
 * Der Hinweis ist ausdrücklich formuliert, statt eine leere Seite zu zeigen:
 * eine Widerrufsbelehrung, die aussieht wie eine, aber keine ist, wäre
 * schlimmer als eine, die offen sagt, dass sie noch fehlt.
 */
const route = useRoute()
const kontakt = useKontaktStore()

const titel = computed(() => String(route.meta.titel ?? ''))
const einleitung = computed(() => String(route.meta.einleitung ?? ''))
const punkte = computed(() => (route.meta.punkte as string[] | undefined) ?? [])
</script>

<template>
  <section class="seite">
    <h1 class="t-h1">{{ titel }}</h1>
    <p class="t-subhead">{{ einleitung }}</p>

    <div class="hinweis">
      <p class="t-h3">Dieser Text fehlt noch</p>
      <p>
        Hier gehört ein geprüfter Text hin. Bis er vorliegt, steht an dieser Stelle nur der
        Hinweis, dass er fehlt — ein Platzhalter, der wie das Echte aussieht, wäre schlimmer
        als gar keiner.
      </p>
      <ul v-if="punkte.length">
        <li v-for="punkt in punkte" :key="punkt">{{ punkt }}</li>
      </ul>
      <p v-if="kontakt.email" class="t-meta">
        Fragen dazu bitte an
        <a :href="`mailto:${kontakt.email}`">{{ kontakt.email }}</a>.
      </p>
    </div>

    <GButton variant="outline" :to="{ name: 'home' }">Zur Übersicht</GButton>
  </section>
</template>

<style scoped>
.seite {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  max-width: 760px;
}

.hinweis {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px 24px;
  border: 1px dashed var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-surface);
}

.hinweis ul {
  margin: 0;
  padding-left: 20px;
  color: var(--c-text-muted);
  font-size: var(--fs-secondary);
}

.hinweis li {
  margin-bottom: 4px;
}
</style>
