<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import { api, ApiError } from '@/api/client'
import type { Column, KommentarEintrag } from '@/types'

/**
 * Die Prüfliste für Beiträge.
 *
 * Geprüft wird nur der ERSTE Beitrag eines Kontos: mit der Freigabe gilt sein
 * Verfasser als vertrauenswürdig, und alles Weitere von ihm erscheint sofort.
 * Deshalb ist diese Liste normalerweise kurz — sie füllt sich nur mit neuen
 * Konten.
 *
 * Antworten schreibt man nicht hier, sondern direkt unter der Übung: dort
 * sieht man den Zusammenhang. Die Spalte „Übung" führt hin.
 */
const rows = ref<KommentarEintrag[]>([])
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)
const nurOffene = ref(true)

const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' })

const columns: Column[] = [
  { label: 'Übung', width: 'minmax(160px,1fr)' },
  { label: 'Von', width: 'minmax(180px,1fr)' },
  { label: 'Beitrag', width: 'minmax(280px,2fr)' },
  { label: 'Geschrieben', width: '130px' },
  { label: 'Status', width: '110px' },
  { width: '260px' },
]

const sichtbar = computed(() =>
  nurOffene.value ? rows.value.filter((row) => row.status === 'offen') : rows.value,
)

const offeneAnzahl = computed(() => rows.value.filter((row) => row.status === 'offen').length)

async function load() {
  try {
    rows.value = await api.get<KommentarEintrag[]>('/admin/kommentare')
    error.value = null
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Laden fehlgeschlagen.'
  }
}

onMounted(load)

async function handeln(row: KommentarEintrag, was: 'freigeben' | 'ablehnen') {
  busy.value = true
  notice.value = null
  error.value = null
  try {
    await api.post(`/admin/kommentare/${row.id}/${was}`)
    notice.value =
      was === 'freigeben'
        ? `Beitrag freigegeben — weitere Beiträge von ${row.email} erscheinen jetzt sofort.`
        : 'Beitrag abgelehnt.'
    await load()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: KommentarEintrag) {
  if (!confirm('Diesen Beitrag endgültig löschen? Antworten darauf verschwinden mit.')) return

  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/kommentare/${row.id}`)
    notice.value = 'Beitrag gelöscht.'
    await load()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Löschen fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

function statusText(row: KommentarEintrag): string {
  if (row.status === 'freigegeben') return 'sichtbar'
  if (row.status === 'abgelehnt') return 'abgelehnt'
  return 'wartet'
}
</script>

<template>
  <section class="page">
    <header class="head">
      <div class="titles">
        <h2 class="t-h2">Beiträge</h2>
        <p class="t-subhead">
          Geprüft wird nur der erste Beitrag eines Kontos. Mit der Freigabe gilt sein Verfasser
          als vertrauenswürdig — alles Weitere von ihm erscheint sofort.
        </p>
      </div>
      <GButton variant="outline" @click="load">Neu laden</GButton>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <label class="filter">
      <input v-model="nurOffene" type="checkbox" />
      Nur wartende anzeigen<template v-if="offeneAnzahl"> ({{ offeneAnzahl }})</template>
    </label>

    <DataTable :columns="columns" :rows="sichtbar" row-key="id" min-width="1150px">
      <template #row="{ row }">
        <!-- Antworten schreibt man unter der Übung, nicht hier — der Verweis
             führt genau dorthin. -->
        <RouterLink :to="{ name: 'video', params: { id: row.videoId } }" class="uebung t-truncate">
          {{ row.videoTitel }}
        </RouterLink>
        <span class="von t-truncate">
          {{ row.vomTeam ? 'Betreiber' : row.email }}
          <template v-if="row.elternId"> · Antwort</template>
        </span>
        <span class="text">{{ row.text }}</span>
        <span class="muted">{{ datum.format(row.angelegtAm) }}</span>
        <span :class="['status', row.status]">{{ statusText(row) }}</span>
        <div class="row-actions">
          <GButton
            v-if="row.status !== 'freigegeben'"
            size="sm"
            :disabled="busy"
            @click="handeln(row, 'freigeben')"
          >
            Freigeben
          </GButton>
          <GButton
            v-if="row.status === 'offen'"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="handeln(row, 'ablehnen')"
          >
            Ablehnen
          </GButton>
          <GButton variant="outline" size="sm" danger :disabled="busy" @click="remove(row)">
            Löschen
          </GButton>
        </div>
      </template>

      <template #empty>
        {{ nurOffene ? 'Nichts zu prüfen.' : 'Noch keine Beiträge.' }}
      </template>
    </DataTable>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 18px;
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
  gap: 8px;
  max-width: 72ch;
}

.notice {
  font-size: var(--fs-secondary);
  color: var(--c-action);
}

.error {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

.filter {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-secondary);
  cursor: pointer;
}

.filter input {
  width: 16px;
  height: 16px;
  accent-color: var(--c-action);
}

.uebung {
  font-size: var(--fs-secondary);
  font-weight: 500;
}

.von {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

/* Der Beitrag selbst ist das, was gelesen werden muss — er darf umbrechen,
   auch wenn alles andere in einer Zeile bleibt. */
.text {
  font-size: var(--fs-secondary);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.muted {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.status {
  font-size: var(--fs-secondary);
}

.status.offen {
  color: var(--c-text-dark);
  font-weight: 500;
}

.status.freigegeben {
  color: var(--c-action);
}

.status.abgelehnt {
  color: var(--c-text-muted);
  text-decoration: line-through;
}

.row-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-wrap: wrap;
}
</style>
