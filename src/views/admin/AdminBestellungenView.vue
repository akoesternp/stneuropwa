<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import { api, ApiError } from '@/api/client'
import type { BestellungEintrag, Column } from '@/types'

/**
 * Bestellungen über Credits.
 *
 * Für PayPal ist das reine Auskunft — dort bucht die Zahlungsbestätigung. Bei
 * Vorkasse ist diese Liste der Arbeitsplatz: Kontoauszug daneben, Referenz
 * vergleichen, bestätigen. Deshalb stehen offene Bestellungen oben und die
 * Referenz vor allem anderen.
 */
const rows = ref<BestellungEintrag[]>([])
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)
const nurOffene = ref(true)

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' })

const columns: Column[] = [
  { label: 'Referenz', width: 'minmax(150px,auto)' },
  { label: 'Konto', width: 'minmax(180px,1fr)' },
  { label: 'Credits', align: 'right', width: '80px' },
  { label: 'Betrag', align: 'right', width: '90px' },
  { label: 'Zahlweg', width: '110px' },
  { label: 'Angelegt', width: '130px' },
  { label: 'Status', width: '120px' },
  { width: '230px' },
]

const sichtbar = computed(() =>
  nurOffene.value ? rows.value.filter((row) => row.status === 'offen') : rows.value,
)

const offeneAnzahl = computed(() => rows.value.filter((row) => row.status === 'offen').length)

async function load() {
  try {
    rows.value = await api.get<BestellungEintrag[]>('/admin/bestellungen')
    error.value = null
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Laden fehlgeschlagen.'
  }
}

onMounted(load)

/**
 * Zahlungseingang bestätigen — hier entsteht echtes Guthaben.
 *
 * Deshalb die Rückfrage mit Betrag und Referenz: verwechselte Zeilen sind bei
 * einer Liste gleichförmiger Beträge der wahrscheinlichste Fehler.
 */
async function bestaetigen(row: BestellungEintrag) {
  const frage =
    `Zahlungseingang für ${row.referenz} bestätigen?\n\n` +
    `${euro.format(row.betragCent / 100)} von ${row.email}\n` +
    `${row.credits} Credits werden sofort gutgeschrieben.`
  if (!confirm(frage)) return

  busy.value = true
  notice.value = null
  error.value = null
  try {
    const ergebnis = await api.post<{ credits: number }>(
      `/admin/bestellungen/${row.id}/bestaetigen`,
    )
    notice.value =
      `${row.referenz} gebucht — ${row.email} hat jetzt ${ergebnis.credits} Credits.`
    await load()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Buchen fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function stornieren(row: BestellungEintrag) {
  if (!confirm(`Bestellung ${row.referenz} stornieren? Es wird nichts gutgeschrieben.`)) return

  busy.value = true
  notice.value = null
  error.value = null
  try {
    await api.post(`/admin/bestellungen/${row.id}/stornieren`)
    notice.value = `${row.referenz} storniert.`
    await load()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Stornieren fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

function statusText(row: BestellungEintrag): string {
  if (row.status === 'bezahlt') return 'gebucht'
  if (row.status === 'storniert') return 'storniert'
  return row.zahlweg === 'vorkasse' ? 'wartet auf Geld' : 'nicht bezahlt'
}
</script>

<template>
  <section class="page">
    <header class="head">
      <div class="titles">
        <h2 class="t-h2">Bestellungen</h2>
        <p class="t-subhead">
          PayPal bucht sich selbst. Bei Vorkasse bestätigen Sie hier den Zahlungseingang —
          erst dann entsteht Guthaben.
        </p>
      </div>
      <GButton variant="outline" @click="load">Neu laden</GButton>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <label class="filter">
      <input v-model="nurOffene" type="checkbox" />
      Nur offene anzeigen<template v-if="offeneAnzahl"> ({{ offeneAnzahl }})</template>
    </label>

    <DataTable :columns="columns" :rows="sichtbar" row-key="id" min-width="1150px">
      <template #row="{ row }">
        <span class="referenz">{{ row.referenz }}</span>
        <span class="konto t-truncate">
          {{ row.email }}<template v-if="row.name"> · {{ row.name }}</template>
        </span>
        <span class="zahl">{{ row.credits }}</span>
        <span class="zahl">{{ euro.format(row.betragCent / 100) }}</span>
        <span class="muted">{{ row.zahlweg === 'paypal' ? 'PayPal' : 'Überweisung' }}</span>
        <span class="muted">{{ datum.format(row.angelegtAm) }}</span>
        <span :class="['status', row.status]">{{ statusText(row) }}</span>
        <div class="row-actions">
          <template v-if="row.status === 'offen'">
            <GButton size="sm" :disabled="busy" @click="bestaetigen(row)">
              Zahlung bestätigt
            </GButton>
            <GButton variant="outline" size="sm" danger :disabled="busy" @click="stornieren(row)">
              Stornieren
            </GButton>
          </template>
          <span v-else-if="row.anbieterReferenz" class="anbieter t-meta">
            {{ row.anbieterReferenz }}
          </span>
        </div>
      </template>

      <template #empty>
        {{ nurOffene ? 'Keine offenen Bestellungen.' : 'Noch keine Bestellungen.' }}
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

/* Die Referenz wird mit einem Kontoauszug verglichen — sie muss zeichengenau
   lesbar sein, nicht hübsch. */
.referenz {
  font-family: var(--font-num);
  font-size: var(--fs-secondary);
  letter-spacing: 0.05em;
}

.konto {
  font-size: var(--fs-secondary);
}

.zahl {
  font-size: var(--fs-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.muted {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.status {
  font-size: var(--fs-secondary);
}

.status.bezahlt {
  color: var(--c-action);
  font-weight: 500;
}

.status.offen {
  color: var(--c-text-dark);
  font-weight: 500;
}

.status.storniert {
  color: var(--c-text-muted);
}

.row-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.anbieter {
  color: var(--c-text-muted);
  font-family: var(--font-num);
}
</style>
