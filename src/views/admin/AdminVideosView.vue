<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import { bildAlsVorschaubild, erzeugeVorschaubild } from '@/utils/vorschaubild'
import type { Column, Paket, Video } from '@/types'

/**
 * Die Kacheln des Portals. Videodateien lassen sich hier hochladen oder per
 * SFTP in die Ablage legen; Titel, Dauer und Paketzuordnung werden hier
 * gepflegt. Die Dauer liest der Server aus der Datei — eingetippt werden muss
 * sie nur, wenn sich der Dateikopf nicht lesen lässt.
 */
interface Datei {
  name: string
  dauer: string
}

const rows = ref<Video[]>([])
const pakete = ref<Paket[]>([])
const dateien = ref<Datei[]>([])

interface Editor {
  id: number | null
  titel: string
  untertitel: string
  beschreibung: string
  dauer: string
  paketIds: number[]
  oeffentlich: boolean
  datei: string
  sortierung: string
  aktiv: boolean
}

const editing = ref<Editor | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

/** Läuft gerade ein Upload? Anteil 0…1, null solange die Größe unbekannt ist. */
const uploadName = ref<string | null>(null)
const uploadAnteil = ref<number | null>(0)
let uploadAbbrechen: (() => void) | null = null

/**
 * Das Vorschaubild wird im Browser aus dem Video gezogen. Bei einem neuen
 * Video gibt es noch keine ID, unter der es abgelegt werden könnte — es
 * wartet deshalb hier, bis das Speichern die ID geliefert hat.
 */
const vorschauBlob = ref<Blob | null>(null)
const vorschauUrl = ref<string | null>(null)
const vorschauLaeuft = ref(false)
/** Sekunde, aus der das Bild stammt — bei einem schwarzen Anfang verstellbar. */
const vorschauSekunde = ref('3')

/**
 * Die zuletzt hochgeladene Datei. Sie bleibt greifbar, damit sich das
 * Vorschaubild auch bei einem noch nicht gespeicherten Video neu erzeugen
 * lässt — dafür gibt es noch keine ID, über die der Stream ginge.
 */
const letzteDatei = ref<File | null>(null)

function setzeVorschau(blob: Blob | null) {
  if (vorschauUrl.value) URL.revokeObjectURL(vorschauUrl.value)
  vorschauBlob.value = blob
  vorschauUrl.value = blob ? URL.createObjectURL(blob) : null
}

/** Zeitstempel bricht den Zwischenspeicher auf, sonst bliebe das alte Bild stehen. */
const gespeichertesBild = ref<string | null>(null)

function zeigeGespeichertesBild(id: number) {
  gespeichertesBild.value = `/api/portal/videos/${id}/thumb?v=${Date.now()}`
}

const columns: Column[] = [
  { label: 'Titel', width: 'minmax(180px,1fr)' },
  { label: 'Untertitel', width: 'minmax(150px,0.9fr)' },
  { label: 'Dauer', width: '80px' },
  { label: 'Sichtbar über', width: 'minmax(150px,0.9fr)' },
  { label: 'Datei', width: 'minmax(150px,0.8fr)' },
  { label: 'Status', width: '90px' },
  { width: '210px' },
]

const isNew = computed(() => editing.value !== null && editing.value.id === null)

/**
 * Bereits anderweitig verknüpfte Dateien bleiben wählbar (zwei Kacheln auf
 * dieselbe Datei sind erlaubt), werden aber gekennzeichnet — sonst verknüpft
 * man versehentlich doppelt.
 */
const dateiOptions = computed<readonly [string, string][]>(() => {
  const belegt = new Map<string, string>()
  for (const video of rows.value) {
    if (video.datei && video.id !== editing.value?.id) belegt.set(video.datei, video.titel)
  }

  return [
    ['', 'Keine Datei (Kachel zeigt „Demnächst")'],
    ...dateien.value.map((datei): [string, string] => [
      datei.name,
      belegt.has(datei.name)
        ? `${datei.name} — verknüpft mit „${belegt.get(datei.name)}"`
        : datei.name,
    ]),
  ]
})

async function load() {
  ;[rows.value, pakete.value, dateien.value] = await Promise.all([
    api.get<Video[]>('/admin/videos'),
    api.get<Paket[]>('/admin/pakete'),
    api.get<{ dateien: Datei[] }>('/admin/video-dateien').then((r) => r.dateien),
  ])
}

onMounted(load)

function startNew() {
  notice.value = null
  error.value = null
  letzteDatei.value = null
  setzeVorschau(null)
  gespeichertesBild.value = null
  vorschauSekunde.value = '3'
  editing.value = {
    id: null,
    titel: '',
    untertitel: '',
    beschreibung: '',
    dauer: '',
    paketIds: [],
    oeffentlich: false,
    datei: '',
    sortierung: '0',
    aktiv: true,
  }
}

function startEdit(row: Video) {
  notice.value = null
  error.value = null
  letzteDatei.value = null
  setzeVorschau(null)
  vorschauSekunde.value = '3'
  zeigeGespeichertesBild(row.id)
  editing.value = {
    id: row.id,
    titel: row.titel,
    untertitel: row.untertitel,
    beschreibung: row.beschreibung,
    dauer: row.dauer,
    paketIds: [...row.paketIds],
    oeffentlich: row.oeffentlich,
    datei: row.datei,
    sortierung: String(row.sortierung),
    aktiv: row.aktiv,
  }
}

function togglePaket(id: number) {
  if (!editing.value) return
  const index = editing.value.paketIds.indexOf(id)
  if (index === -1) editing.value.paketIds.push(id)
  else editing.value.paketIds.splice(index, 1)
}

/**
 * Übernimmt die Dauer der gewählten Datei, sobald das Feld leer ist — ein
 * von Hand eingetragener Wert wird nie überschrieben.
 */
function onDateiGewaehlt() {
  if (!editing.value) return
  const treffer = dateien.value.find((datei) => datei.name === editing.value!.datei)
  if (treffer?.dauer && !editing.value.dauer) editing.value.dauer = treffer.dauer
}

/**
 * Lädt die gewählte Datei hoch und verknüpft sie gleich mit dem offenen
 * Formular. Titel und Dauer werden vorbelegt, soweit sie noch leer sind:
 * beim ersten Anlegen spart das jedes Tippen außer der Paketzuordnung.
 */
async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // damit dieselbe Datei erneut gewählt werden kann
  if (!file || !editing.value) return

  notice.value = null
  error.value = null
  uploadName.value = file.name
  uploadAnteil.value = 0
  letzteDatei.value = file

  try {
    const { versprechen, abbrechen } = api.upload<{ datei: string; dauer: string; groesse: number }>(
      `/admin/upload?name=${encodeURIComponent(file.name)}`,
      file,
      (anteil) => {
        uploadAnteil.value = anteil
      },
    )
    uploadAbbrechen = abbrechen

    const ergebnis = await versprechen

    editing.value.datei = ergebnis.datei
    if (!editing.value.dauer) editing.value.dauer = ergebnis.dauer
    if (!editing.value.titel) {
      // Dateiname ohne Endung als Vorschlag — Bindestriche werden zu Leerzeichen.
      editing.value.titel = ergebnis.datei.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
    }

    dateien.value = await api
      .get<{ dateien: Datei[] }>('/admin/video-dateien')
      .then((r) => r.dateien)

    notice.value = ergebnis.dauer
      ? `${ergebnis.datei} hochgeladen (${ergebnis.dauer}). Noch speichern nicht vergessen.`
      : `${ergebnis.datei} hochgeladen. Die Dauer ließ sich nicht auslesen — bitte eintragen.`
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Der Upload ist fehlgeschlagen.'
  } finally {
    uploadName.value = null
    uploadAbbrechen = null
  }
}

function abbrechenUpload() {
  uploadAbbrechen?.()
}

/** Steht überhaupt eine Quelle für das Vorschaubild bereit? */
const vorschauMoeglich = computed(
  () => Boolean(letzteDatei.value) || Boolean(editing.value?.id && editing.value.datei),
)

/**
 * Erzeugt das Vorschaubild — aus der gerade hochgeladenen Datei, sonst aus
 * der bereits verknüpften über den Verwaltungs-Stream (so auch für Dateien,
 * die per SFTP hereinkamen). Der Browser liest dabei nur den Dateikopf und
 * ein Stück um die gesuchte Stelle.
 */
/**
 * Löst die Datei vom Video — der Platz wird wieder frei, die Datei selbst
 * bleibt in der Ablage. Sie absichtlich NICHT zu löschen ist die
 * zurückhaltendere Wahl: unter Umständen hängt ein zweites Video daran, und
 * ein versehentliches Entfernen soll keine Datei kosten, die per SFTP
 * mühsam hochgeladen wurde.
 */
function dateiEntfernen() {
  if (!editing.value) return
  editing.value.datei = ''
  letzteDatei.value = null
  error.value = null
  notice.value =
    'Datei entfernt — mit „Speichern" gilt das Video als ohne Video. Die Datei bleibt in der Ablage.'
}

/** Ein selbst gewähltes Bild als Vorschaubild übernehmen. */
async function onBildGewaehlt(event: Event) {
  const input = event.target as HTMLInputElement
  const datei = input.files?.[0]
  input.value = '' // damit dieselbe Datei erneut gewählt werden kann
  if (!datei) return

  notice.value = null
  error.value = null
  vorschauLaeuft.value = true
  try {
    setzeVorschau(await bildAlsVorschaubild(datei))
    notice.value = 'Bild übernommen. Mit „Speichern" wird es gesetzt.'
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'Das Bild ließ sich nicht übernehmen.'
  } finally {
    vorschauLaeuft.value = false
  }
}

async function vorschauAusDatei() {
  const quelle =
    letzteDatei.value ??
    (editing.value?.id && editing.value.datei
      ? `/api/admin/videos/${editing.value.id}/stream`
      : null)

  if (!quelle) return

  notice.value = null
  error.value = null
  vorschauLaeuft.value = true
  try {
    setzeVorschau(await erzeugeVorschaubild(quelle, Number(vorschauSekunde.value) || 3))
    notice.value = 'Vorschaubild erzeugt. Mit „Speichern" wird es übernommen.'
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'Das Vorschaubild ließ sich nicht erzeugen.'
  } finally {
    vorschauLaeuft.value = false
  }
}

/** Legt das Bild unter der Video-ID ab; Fehler hier sind kein Grund zum Scheitern. */
async function speichereVorschau(videoId: number): Promise<boolean> {
  if (!vorschauBlob.value) return false
  try {
    await api.upload(`/admin/videos/${videoId}/thumb`, vorschauBlob.value).versprechen
    return true
  } catch {
    return false
  }
}

async function save() {
  if (!editing.value) return
  if (!editing.value.titel.trim()) {
    error.value = 'Der Titel ist Pflicht.'
    return
  }

  busy.value = true
  error.value = null
  try {
    const ergebnis = await api.put<{ id: number }>('/admin/videos', {
      id: editing.value.id,
      titel: editing.value.titel,
      untertitel: editing.value.untertitel,
      beschreibung: editing.value.beschreibung,
      dauer: editing.value.dauer,
      paketIds: editing.value.paketIds,
      oeffentlich: editing.value.oeffentlich,
      datei: editing.value.datei,
      sortierung: Number(editing.value.sortierung) || 0,
      aktiv: editing.value.aktiv,
    })
    const mitBild = await speichereVorschau(ergebnis.id)

    await load()
    notice.value = mitBild
      ? `${editing.value.titel} samt Vorschaubild gespeichert.`
      : `${editing.value.titel} gespeichert.`
    setzeVorschau(null)
    editing.value = null
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Speichern fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: Video) {
  if (!confirm(`Video „${row.titel}" wirklich löschen?`)) return
  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/videos/${row.id}`)
    await load()
    notice.value = `${row.titel} gelöscht. Die Videodatei bleibt in der Ablage.`
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Löschen fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="page">
    <header class="head">
      <div class="titles">
        <h2 class="t-h2">Videos</h2>
        <p class="t-subhead">
          Ohne Paket ist eine Kachel öffentlich sichtbar; mehrere Pakete sind möglich. Die Dauer
          liest der Server aus der Datei.
        </p>
      </div>
      <GButton @click="startNew">Neues Video</GButton>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <GCard v-if="editing" class="editor">
      <h3 class="t-h3">{{ isNew ? 'Neues Video' : `Video ${editing.titel}` }}</h3>

      <!-- Upload zuerst: bei einem neuen Video füllt er Titel und Dauer gleich mit. -->
      <!--
        Ein Video hat genau eine Datei. Solange eine verknüpft ist, gibt es
        weder Upload noch Auswahl — erst das Entfernen macht den Platz wieder
        frei. Sonst ließe sich unbemerkt eine zweite hochladen, die dann
        unbenutzt in der Ablage läge.
      -->
      <div class="upload">
        <div class="upload-kopf">
          <span class="t-eyebrow">Videodatei</span>
          <span class="t-meta">MP4, M4V, MOV oder WebM</span>
        </div>

        <template v-if="editing.datei && !uploadName">
          <div class="belegt">
            <span class="belegt-name t-truncate">{{ editing.datei }}</span>
            <GButton variant="outline" size="sm" danger :disabled="busy" @click="dateiEntfernen">
              Entfernen
            </GButton>
          </div>
          <p class="hint">
            Für eine andere Datei zuerst diese entfernen. Sie bleibt dabei in der Ablage und
            lässt sich danach wieder auswählen — gelöscht wird nichts.
          </p>
        </template>

        <template v-else-if="uploadName">
          <div class="fortschritt">
            <div
              class="balken"
              :class="{ unbestimmt: uploadAnteil === null }"
              :style="uploadAnteil !== null ? { width: `${Math.round(uploadAnteil * 100)}%` } : undefined"
            />
          </div>
          <div class="upload-zeile">
            <span class="t-meta">
              {{ uploadName }} —
              {{ uploadAnteil === null ? 'wird übertragen …' : `${Math.round(uploadAnteil * 100)} %` }}
            </span>
            <GButton variant="outline" size="sm" danger @click="abbrechenUpload">Abbrechen</GButton>
          </div>
        </template>

        <template v-else>
          <input type="file" accept="video/*,.mp4,.m4v,.mov,.webm" @change="onUpload" />
          <p class="hint">
            Sehr große Dateien gehen zuverlässiger per SFTP in die Ablage — sie stehen dann
            gleich hier in der Auswahl.
          </p>
          <GField
            v-model="editing.datei"
            as="select"
            label="Oder aus der Ablage wählen"
            :options="dateiOptions"
            compact
            @update:model-value="onDateiGewaehlt"
          />
        </template>
      </div>

      <!--
        Das Bild steht später an jeder Kachel — auch an gesperrten. Es wird im
        Browser aus dem Video gezogen, der Server bekommt nur das fertige JPEG.
      -->
      <div class="vorschau">
        <div class="vorschau-bild">
          <img v-if="vorschauUrl" :src="vorschauUrl" alt="Neues Vorschaubild" />
          <img v-else-if="gespeichertesBild" :src="gespeichertesBild" alt="Vorschaubild" @error="gespeichertesBild = null" />
          <span v-else class="ohne t-meta">Kein Vorschaubild</span>
        </div>

        <div class="vorschau-steuerung">
          <span class="t-eyebrow">Vorschaubild</span>
          <p class="hint">
            Aus dem Video an der gewählten Sekunde erzeugen — oder ein eigenes Bild hochladen.
          </p>

          <div class="vorschau-zeile">
            <GField v-model="vorschauSekunde" label="Sekunde" type="number" compact />
            <GButton
              variant="outline"
              size="sm"
              :disabled="!vorschauMoeglich || vorschauLaeuft"
              @click="vorschauAusDatei"
            >
              {{ vorschauLaeuft ? 'Wird erzeugt …' : 'Aus Video erzeugen' }}
            </GButton>
          </div>

          <p v-if="!vorschauMoeglich" class="hint">
            Für „Aus Video erzeugen" erst eine Videodatei hochladen oder auswählen.
          </p>

          <label class="eigenes">
            <span class="t-eyebrow">Oder eigenes Bild</span>
            <input type="file" accept="image/*" :disabled="vorschauLaeuft" @change="onBildGewaehlt" />
          </label>
        </div>
      </div>

      <div class="fields">
        <GField v-model="editing.titel" label="Titel" compact />
        <GField v-model="editing.untertitel" label="Untertitel" compact />
        <GField
          v-model="editing.dauer"
          label="Dauer"
          placeholder="wird aus der Datei gelesen"
          compact
        />
        <GField v-model="editing.sortierung" label="Sortierung" type="number" compact />
      </div>

      <!--
        Steht auch an gesperrten Kacheln in der Paketübersicht — der Text soll
        sagen, worum es geht, ohne den Inhalt vorwegzunehmen.
      -->
      <GField
        v-model="editing.beschreibung"
        as="textarea"
        label="Beschreibung (auch bei gesperrten Videos sichtbar)"
        placeholder="Worum geht es in diesem Video? Zwei bis drei Sätze genügen."
        compact
      />

      <!--
        „Öffentlich" steht bewusst in derselben Liste wie die Pakete: es ist
        eine weitere Art, ein Video sichtbar zu machen, und schließt die
        Pakete nicht aus. Ein Video kann in Paketen liegen UND frei sein —
        etwa als Schnupperfolge.
      -->
      <div class="assign">
        <span class="t-eyebrow">Sichtbar über</span>
        <div class="paket-list">
          <label class="paket oeffentlich">
            <input v-model="editing.oeffentlich" type="checkbox" />
            Öffentlich <span class="t-meta">(ohne Anmeldung)</span>
          </label>

          <label v-for="paket in pakete" :key="paket.id" class="paket">
            <input
              type="checkbox"
              :checked="editing.paketIds.includes(paket.id)"
              @change="togglePaket(paket.id)"
            />
            {{ paket.name }}
            <span v-if="!paket.aktiv" class="t-meta">(inaktiv)</span>
          </label>
        </div>
        <p class="hint">
          <template v-if="!editing.oeffentlich && !editing.paketIds.length">
            Ohne Haken sieht das Video nur, wem es unter „Nutzer" einzeln freigeschaltet wurde.
          </template>
          <template v-else>
            Mehrfachauswahl möglich — öffentlich und in Paketen zugleich ist erlaubt.
          </template>
        </p>
      </div>

      <label class="aktiv">
        <input v-model="editing.aktiv" type="checkbox" />
        Video aktiv — ohne Haken taucht die Kachel nirgends auf
      </label>

      <div class="editor-actions">
        <GButton :disabled="busy || !!uploadName" @click="save">Speichern</GButton>
        <GButton variant="outline" :disabled="busy" @click="editing = null">Abbrechen</GButton>
      </div>
    </GCard>

    <DataTable :columns="columns" :rows="rows" row-key="id" min-width="1200px">
      <template #row="{ row }">
        <span class="name t-truncate">{{ row.titel }}</span>
        <span class="muted t-truncate">{{ row.untertitel || '—' }}</span>
        <span class="muted">{{ row.dauer || '—' }}</span>
        <span class="muted t-truncate">
          {{
            [...(row.oeffentlich ? ['Öffentlich'] : []), ...row.paketNamen].join(', ') ||
            'nur einzeln'
          }}
        </span>
        <span :class="row.datei ? 'muted' : 'flag'" class="t-truncate">
          {{ row.datei || 'keine Datei' }}
        </span>
        <span :class="row.aktiv ? 'ok' : 'flag'">{{ row.aktiv ? 'aktiv' : 'inaktiv' }}</span>
        <div class="row-actions">
          <GButton variant="ghost" size="sm" @click="startEdit(row)">Bearbeiten</GButton>
          <GButton variant="outline" size="sm" danger @click="remove(row)">Löschen</GButton>
        </div>
      </template>

      <template #empty>Noch keine Videos angelegt.</template>
    </DataTable>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 22px;
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

.notice {
  font-size: var(--fs-secondary);
  color: var(--c-positive);
}

.error {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── Upload ────────────────────────────────────────────────────────── */
.upload {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-surface-2);
}

.upload-kopf {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.upload input[type='file'] {
  font-size: var(--fs-secondary);
}

.belegt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 14px;
  border-radius: var(--r-card);
  background: var(--c-white);
  border: 1px solid var(--c-hairline);
}

.belegt-name {
  font-family: var(--font-num);
  font-size: var(--fs-secondary);
}

.fortschritt {
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--c-hairline);
  overflow: hidden;
}

.balken {
  height: 100%;
  background: var(--c-action);
  transition: width 0.2s ease;
}

/* Ohne bekannte Gesamtgröße: volle Breite statt einer erfundenen Zahl. */
.balken.unbestimmt {
  width: 100%;
  opacity: 0.5;
}

.upload-zeile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.vorschau {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.vorschau-bild {
  flex: none;
  width: 240px;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-card);
  background: var(--c-surface);
  border: 1px solid var(--c-hairline);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vorschau-bild img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.vorschau-steuerung {
  flex: 1 1 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vorschau-zeile {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.vorschau-zeile :deep(.g-field) {
  width: 110px;
  flex: none;
}

.eigenes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.eigenes input {
  font-size: var(--fs-secondary);
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.assign {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hint {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.paket-list {
  display: flex;
  gap: 10px 22px;
  flex-wrap: wrap;
}

.paket,
.aktiv {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: var(--fs-secondary);
}

/* Der Öffentlich-Schalter gehört sichtbar zur Liste, ist aber kein Paket. */
.oeffentlich {
  padding-right: 16px;
  margin-right: 6px;
  border-right: 1px solid var(--c-hairline);
  font-weight: 500;
}

.paket input,
.aktiv input {
  width: 16px;
  height: 16px;
  accent-color: var(--c-action);
}

.editor-actions {
  display: flex;
  gap: 12px;
}

.name {
  font-size: var(--fs-body);
  font-weight: 500;
}

.muted {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.ok {
  font-size: var(--fs-secondary);
  color: var(--c-positive);
}

.flag {
  font-size: var(--fs-secondary);
  color: var(--c-orange);
}

.row-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
