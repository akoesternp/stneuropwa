<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePaketeStore } from '@/stores/pakete'

/**
 * Die Paketübersicht — bewusst auch ohne Anmeldung erreichbar: wer wissen
 * will, was ein Paket enthält, soll das sehen, bevor er einen Zugang hat.
 */
const auth = useAuthStore()
const pakete = usePaketeStore()

onMounted(() => {
  void pakete.ensureLoaded()
})

// Mit der Sitzung ändert sich, was als freigeschaltet gilt.
watch(
  () => auth.isAuthenticated,
  () => void pakete.reload(),
)

function freigeschaltet(paketName: string): boolean {
  return auth.user?.pakete.includes(paketName) ?? false
}
</script>

<template>
  <section class="pakete">
    <header class="head">
      <div class="titles">
        <h1 class="t-h2">Pakete</h1>
        <p class="t-subhead">
          Jedes Paket bündelt eine Videoreihe. Sehen Sie hier, was enthalten ist —
          <template v-if="!auth.isAuthenticated">abspielbar nach der Freischaltung.</template>
          <template v-else>Ihre freigeschalteten Pakete sind gekennzeichnet.</template>
        </p>
      </div>
    </header>

    <p v-if="pakete.error" class="state error" role="alert">{{ pakete.error }}</p>
    <p v-else-if="!pakete.loaded" class="state">Pakete werden geladen …</p>
    <p v-else-if="!pakete.pakete.length" class="state">Es sind noch keine Pakete angelegt.</p>

    <div v-else class="grid">
      <RouterLink
        v-for="paket in pakete.pakete"
        :key="paket.id"
        class="karte"
        :to="{ name: 'paket', params: { id: paket.id } }"
      >
        <div class="kopf">
          <h2 class="t-h3">{{ paket.name }}</h2>
          <span v-if="freigeschaltet(paket.name)" class="marke frei">Freigeschaltet</span>
        </div>

        <p v-if="paket.beschreibung" class="beschreibung">{{ paket.beschreibung }}</p>

        <ul class="vorschau">
          <li v-for="video in paket.videos.slice(0, 3)" :key="video.id">
            <span class="t-truncate">{{ video.titel }}</span>
            <span class="dauer t-meta">{{ video.dauer || '–' }}</span>
          </li>
        </ul>

        <p class="fuss t-meta">
          {{ paket.videos.length }} Video{{ paket.videos.length === 1 ? '' : 's' }}<template
            v-if="paket.gesamtdauer"
          >
            · {{ paket.gesamtdauer }} Laufzeit</template
          >
          <template v-if="paket.videos.length > 3"> · vollständige Liste ansehen</template>
        </p>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.pakete {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.titles {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.state {
  font-size: var(--fs-body);
  color: var(--c-subhead);
}

.state.error {
  color: var(--c-red);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 22px;
}

.karte {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: var(--card-pad);
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
  color: var(--c-text);
}

.karte:hover {
  border-color: var(--c-action);
  color: var(--c-text);
  text-decoration: none;
}

.kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.marke {
  flex: none;
  padding: 3px 12px;
  border-radius: var(--r-pill);
  font-family: var(--font-num);
  font-size: var(--fs-meta);
}

.marke.frei {
  background: var(--c-tint);
  color: var(--c-action);
}

.beschreibung {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--c-text-muted);
}

.vorschau {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--c-hairline-2);
  padding-top: 14px;
}

.vorschau li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-secondary);
  min-width: 0;
}

.dauer {
  flex: none;
}

.fuss {
  margin-top: auto;
}
</style>
