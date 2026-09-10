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
  { label: 'Neuro', align: 'right', width: '80px' },
  { label: 'Betrag', align: 'right', width: '90px' },
  { label: 'Zahlweg', width: '110px' },
  { label: 'Angelegt', width: '130px' },
  { label: 'Status', width: '120px' },
  { width: '330px' },
]

/*
 * „Nur offene" heißt: was auf MICH wartet. Entwürfe warten auf den Käufer
 * und gehören nicht in dieselbe Liste — sonst stünde dort vor allem, wer
 * sich die Bankdaten bloß angesehen hat.
 */
const sichtbar = computed(() =>
  nurOffene.value ? rows.value.filter((row) => row.status === 'offen') : rows.value,
)

const entwuerfe = computed(() => rows.value.filter((row) => row.status === 'entwurf').length)

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
    `${row.credits} Neuro werden sofort gutgeschrieben.`
  if (!confirm(frage)) return

  busy.value = true
  notice.value = null
  error.value = null
  try {
    const ergebnis = await api.post<{ credits: number }>(
      `/admin/bestellungen/${row.id}/bestaetigen`,
    )
    notice.value =
      `${row.referenz} gebucht — ${row.email} hat jetzt ${ergebnis.credits} Neuro.`
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

/**
 * Nachfassen bei PayPal: holt eine freigegebene, aber nicht abgeschlossene
 * Zahlung nach. Der Betrag wird dabei geprüft; gebucht wird genau einmal.
 */
async function einziehen(row: BestellungEintrag) {
  busy.value = true
  notice.value = null
  error.value = null
  try {
    const antwort = await api.post<{ gutgeschrieben?: number; schonGebucht?: boolean }>(
      `/admin/bestellungen/${row.id}/einziehen`,
      {},
    )
    notice.value = antwort.schonGebucht
      ? `${row.referenz} war bereits gebucht.`
      : `${row.referenz}: ${antwort.gutgeschrieben} Neuro eingezogen und gutgeschrieben.`
    await load()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Einziehen fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

function statusText(row: BestellungEintrag): string {
  if (row.status === 'bezahlt') return 'gebucht'
  if (row.status === 'storniert') return 'storniert'
  if (row.status === 'abgelaufen') return 'abgelaufen'
  if (row.status === 'entwurf') {
    return row.zahlweg === 'vorkasse' ? 'nur angesehen' : 'nicht abgeschlossen'
  }
  return row.zahlweg === 'vorkasse' ? 'wartet auf Geld' : 'nicht bezahlt'
}

/**
 * Was die Zeile in einem Satz sagt.
 *
 * „nur angesehen" ist die Auskunft, die vorher fehlte: derjenige hat sich
 * die Bankdaten geben lassen und nichts weiter gemeldet. Ob doch Geld kommt,
 * weiß niemand — deshalb steht die Zeile da, aber nicht in der Arbeitsliste.
 */
function erklaerung(row: BestellungEintrag): string {
  if (row.status !== 'entwurf') return ''
  return row.zahlweg === 'vorkasse'
    ? 'Bankdaten angezeigt, Überweisung nicht gemeldet'
    : 'Bei PayPal begonnen, nicht abgeschlossen'
}
</script>

<template>
  <section class="page">
    <header class="head">
      <div class="titles">
        <h2 class="t-h2">Bestellungen</h2>
        <p class="t-subhead">
          PayPal bucht sich selbst; bleibt eine Zahlung hängen, ziehen Sie sie hier ein.
          Bei Vorkasse bestätigen Sie den Zahlungseingang — erst dann entsteht Guthaben.
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

    <p v-if="nurOffene && entwuerfe" class="t-meta hinweis-entwuerfe">
      Dazu {{ entwuerfe }} angefangene, die auf den Käufer warten — ohne den Filter zu sehen.
    </p>

    <DataTable :columns="columns" :rows="sichtbar" row-key="id" min-width="1260px">
      <template #row="{ row }">
        <span class="referenz">{{ row.referenz }}</span>
        <span class="konto t-truncate">
          {{ row.email }}<template v-if="row.name"> · {{ row.name }}</template>
        </span>
        <span class="zahl">{{ row.credits }}</span>
        <span class="zahl">{{ euro.format(row.betragCent / 100) }}</span>
        <span class="muted">{{ row.zahlweg === 'paypal' ? 'PayPal' : 'Überweisung' }}</span>
        <span class="muted">{{ datum.format(row.angelegtAm) }}</span>
        <span :class="['status', row.status]" :title="erklaerung(row)">
          {{ statusText(row) }}
        </span>
        <div class="row-actions">
          <!--
            Bei PayPal wird nicht von Hand gebucht: ob Geld geflossen ist,
            weiß allein PayPal. „Einziehen" fragt dort nach und holt eine
            freigegebene Zahlung nach — der übliche Fall ist ein zu früh
            geschlossener Reiter.
          -->
          <GButton
            v-if="row.zahlweg === 'paypal' && row.status !== 'bezahlt' && row.status !== 'storniert'"
            size="sm"
            :disabled="busy"
            @click="einziehen(row)"
          >
            Bei PayPal einziehen
          </GButton>

          <GButton
            v-if="row.zahlweg === 'vorkasse' && (row.status === 'offen' || row.status === 'entwurf')"
            size="sm"
            :disabled="busy"
            @click="bestaetigen(row)"
          >
            Zahlung bestätigt
          </GButton>

          <GButton
            v-if="row.status === 'offen' || row.status === 'entwurf' || row.status === 'abgelaufen'"
            variant="outline"
            size="sm"
            danger
            :disabled="busy"
            @click="stornieren(row)"
          >
            Stornieren
          </GButton>

          <span v-if="row.status === 'bezahlt' && row.anbieterReferenz" class="anbieter t-meta">
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

.hinweis-entwuerfe {
  margin: -6px 0 10px;
  color: var(--c-text-muted);
}

.status.entwurf,
.status.abgelaufen {
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
