<script setup lang="ts">
import { onMounted, watch } from 'vue'
import PaketKarte from '@/components/PaketKarte.vue'
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
      <PaketKarte v-for="paket in pakete.pakete" :key="paket.id" :paket="paket" />
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

/* Die Kartenstile stehen in PaketKarte.vue — hier bleibt nur das Raster. */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 22px;
}
</style>
