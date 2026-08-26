<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import VideoTile from '@/components/VideoTile.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useFortschrittStore } from '@/stores/fortschritt'
import { useVideosStore } from '@/stores/videos'
import { dauerInSekunden } from '@/utils/format'
import { SCHWIERIGKEITEN } from '@shared/types'
import type { Video } from '@/types'

/**
 * Die Startseite.
 *
 * Ein flaches Raster aller Videos trägt nur, solange es wenige sind. Sobald
 * ein Bestand entsteht, sucht niemand mehr „ein Video", sondern die passende
 * Übung — deshalb Suche und Filter oben, und darunter nach Paketen gegliedert
 * statt alles in einem Topf.
 */
const auth = useAuthStore()
const videos = useVideosStore()
const fortschritt = useFortschrittStore()

/** So viele Kacheln je Abschnitt; der Rest steht auf der Paketseite. */
const JE_ABSCHNITT = 8

const suche = ref('')
const bereichFilter = ref<string[]>([])
const schwierigkeitFilter = ref<string[]>([])

onMounted(() => {
  void videos.ensureLoaded()
  if (auth.isAuthenticated) void fortschritt.reload()
})

/*
 * Nach An- oder Abmeldung ändert sich, was der Server herausgibt — die Liste
 * folgt also der Sitzung, nicht einem eigenen Zustand.
 */
watch(
  () => auth.isAuthenticated,
  (angemeldet) => {
    void videos.reload()
    if (angemeldet) void fortschritt.reload()
  },
)

function umschalten(liste: string[], wert: string) {
  const index = liste.indexOf(wert)
  if (index === -1) liste.push(wert)
  else liste.splice(index, 1)
}

const filterAktiv = computed(
  () =>
    suche.value.trim().length > 0 ||
    bereichFilter.value.length > 0 ||
    schwierigkeitFilter.value.length > 0,
)

function zuruecksetzen() {
  suche.value = ''
  bereichFilter.value = []
  schwierigkeitFilter.value = []
}

const treffer = computed(() => {
  const begriff = suche.value.trim().toLowerCase()

  return videos.videos.filter((video) => {
    if (bereichFilter.value.length && !bereichFilter.value.includes(video.bereich)) return false
    if (schwierigkeitFilter.value.length && !schwierigkeitFilter.value.includes(video.schwierigkeit))
      return false
    if (!begriff) return true

    // Hilfsmittel bewusst durchsuchbar: „ohne Ball" ist eine echte Frage.
    return [video.titel, video.untertitel, video.beschreibung, video.hilfsmittel]
      .join(' ')
      .toLowerCase()
      .includes(begriff)
  })
})

/** Angesehener Anteil einer Übung, 0 wenn nichts bekannt ist. */
function anteil(video: Video): number {
  const stand = fortschritt.fuer(video.id)
  if (!stand?.position) return 0
  const gesamt = dauerInSekunden(video.dauer)
  return gesamt ? stand.position / gesamt : 0
}

function erledigt(video: Video): boolean {
  return fortschritt.fuer(video.id)?.erledigt ?? false
}

/** Angefangen, aber weder fertig noch abgehakt — die Zeile ganz oben. */
const weiterschauen = computed(() => {
  if (!auth.isAuthenticated) return []

  return fortschritt.zuletzt
    .filter((stand) => stand.position > 0 && !stand.erledigt)
    .map((stand) => videos.videos.find((video) => video.id === stand.videoId))
    .filter((video): video is Video => Boolean(video))
    .slice(0, 4)
})

interface Abschnitt {
  schluessel: string
  titel: string
  /** Ziel für „Alle ansehen" — nur bei Paketen gesetzt. */
  paketId: number | null
  videos: Video[]
  erledigtAnzahl: number
}

/**
 * Ein Abschnitt je Paket, dazu einer für die frei verfügbaren Übungen.
 *
 * Gruppiert wird aus der Videoliste heraus, nicht aus der Paketübersicht:
 * dort steht auch, was dieser Aufrufer gar nicht sehen darf.
 */
const abschnitte = computed<Abschnitt[]>(() => {
  const nachPaket = new Map<number, Abschnitt>()
  const frei: Video[] = []
  const einzeln: Video[] = []

  // Die Pakete, die dem Nutzer wirklich gehören.
  const eigene = new Set(auth.user?.pakete ?? [])

  for (const video of videos.videos) {
    /*
     * Nur eigene Pakete bekommen einen Abschnitt. Sonst stünde ein einzeln
     * freigeschaltetes Video unter der Überschrift eines Pakets, das dem
     * Nutzer gar nicht gehört — samt Verweis auf eine Paketseite, auf der
     * alles Übrige gesperrt ist.
     */
    const eigenePakete = video.paketIds.filter((_, stelle) =>
      eigene.has(video.paketNamen[stelle] ?? ''),
    )

    if (!eigenePakete.length) {
      // Sichtbar aus einem anderen Grund: entweder frei oder einzeln zugeteilt.
      if (video.oeffentlich) frei.push(video)
      else einzeln.push(video)
      continue
    }

    eigenePakete.forEach((paketId) => {
      const stelle = video.paketIds.indexOf(paketId)
      const vorhanden = nachPaket.get(paketId)
      if (vorhanden) {
        vorhanden.videos.push(video)
        return
      }
      nachPaket.set(paketId, {
        schluessel: `paket-${paketId}`,
        titel: video.paketNamen[stelle] ?? 'Paket',
        paketId,
        videos: [video],
        erledigtAnzahl: 0,
      })
    })
  }

  const liste = [...nachPaket.values()]
  if (einzeln.length) {
    liste.push({
      schluessel: 'einzeln',
      titel: 'Für Sie freigeschaltet',
      paketId: null,
      videos: einzeln,
      erledigtAnzahl: 0,
    })
  }
  if (frei.length) {
    liste.push({
      schluessel: 'frei',
      titel: 'Frei verfügbar',
      paketId: null,
      videos: frei,
      erledigtAnzahl: 0,
    })
  }

  for (const abschnitt of liste) {
    abschnitt.erledigtAnzahl = abschnitt.videos.filter(erledigt).length
  }

  return liste
})
</script>

<template>
  <section class="home">
    <header class="head">
      <div class="titles">
        <h1 class="t-h2">
          {{ auth.isAuthenticated ? `Hallo ${auth.user?.name || 'und willkommen'}` : 'Übungen' }}
        </h1>
        <p class="t-subhead">
          {{
            auth.isAuthenticated
              ? 'Ihre freigeschalteten Übungen und alle frei verfügbaren.'
              : 'Frei verfügbare Übungen — mehr Inhalte nach der Anmeldung.'
          }}
        </p>
      </div>
    </header>

    <!-- Suche und Filter stehen über allem: sie sind der schnellste Weg zur
         passenden Übung, sobald der Bestand über ein paar Dutzend wächst. -->
    <div class="filter">
      <label class="suchfeld">
        <span class="visually-hidden">Übungen durchsuchen</span>
        <span class="lupe" aria-hidden="true">⌕</span>
        <input
          v-model="suche"
          type="search"
          placeholder="Übung, Beschreibung oder Hilfsmittel suchen …"
        />
      </label>

      <div class="chips">
        <button
          v-for="bereich in videos.bereiche"
          :key="bereich"
          type="button"
          class="chip"
          :class="{ an: bereichFilter.includes(bereich) }"
          @click="umschalten(bereichFilter, bereich)"
        >
          {{ bereich }}
        </button>

        <span class="trenner" aria-hidden="true" />

        <button
          v-for="grad in SCHWIERIGKEITEN"
          :key="grad"
          type="button"
          class="chip"
          :class="{ an: schwierigkeitFilter.includes(grad) }"
          @click="umschalten(schwierigkeitFilter, grad)"
        >
          {{ grad }}
        </button>

        <GButton v-if="filterAktiv" variant="text" @click="zuruecksetzen">Zurücksetzen</GButton>
      </div>
    </div>

    <p v-if="videos.error" class="state error" role="alert">{{ videos.error }}</p>
    <p v-else-if="!videos.loaded" class="state">Inhalte werden geladen …</p>

    <template v-else>
      <!-- Mit Suche oder Filter zählt nur die Trefferliste; die Gliederung
           nach Paketen stünde dem dann im Weg. -->
      <template v-if="filterAktiv">
        <p class="state">
          {{ treffer.length }} {{ treffer.length === 1 ? 'Übung gefunden' : 'Übungen gefunden' }}
        </p>
        <div v-if="treffer.length" class="grid">
          <VideoTile
            v-for="video in treffer"
            :id="video.id"
            :key="video.id"
            :titel="video.titel"
            :untertitel="video.untertitel"
            :beschreibung="video.beschreibung"
            :dauer="video.dauer"
            :kategorien="[video.bereich, video.schwierigkeit].filter(Boolean)"
            :hilfsmittel="video.hilfsmittel"
            :marken="[...(video.oeffentlich ? ['Frei verfügbar'] : []), ...video.paketNamen]"
            :ohne-datei="!video.datei"
            :anteil="anteil(video)"
            :erledigt="erledigt(video)"
          />
        </div>
      </template>

      <template v-else>
        <section v-if="weiterschauen.length" class="abschnitt">
          <header class="abschnitt-kopf">
            <h2 class="t-h3">Weiterschauen</h2>
          </header>
          <div class="grid">
            <VideoTile
              v-for="video in weiterschauen"
              :id="video.id"
              :key="video.id"
              :titel="video.titel"
              :untertitel="video.untertitel"
              :dauer="video.dauer"
              :kategorien="[video.bereich, video.schwierigkeit].filter(Boolean)"
              :ohne-datei="!video.datei"
              :anteil="anteil(video)"
            />
          </div>
        </section>

        <section v-for="abschnitt in abschnitte" :key="abschnitt.schluessel" class="abschnitt">
          <header class="abschnitt-kopf">
            <h2 class="t-h3">
              <RouterLink
                v-if="abschnitt.paketId"
                :to="{ name: 'paket', params: { id: abschnitt.paketId } }"
              >
                {{ abschnitt.titel }}
              </RouterLink>
              <template v-else>{{ abschnitt.titel }}</template>
            </h2>

            <span class="zaehler t-meta">
              <template v-if="auth.isAuthenticated && abschnitt.erledigtAnzahl">
                {{ abschnitt.erledigtAnzahl }} von {{ abschnitt.videos.length }} erledigt
              </template>
              <template v-else>
                {{ abschnitt.videos.length }}
                {{ abschnitt.videos.length === 1 ? 'Übung' : 'Übungen' }}
              </template>
            </span>
          </header>

          <div class="grid">
            <VideoTile
              v-for="video in abschnitt.videos.slice(0, JE_ABSCHNITT)"
              :id="video.id"
              :key="video.id"
              :titel="video.titel"
              :untertitel="video.untertitel"
              :beschreibung="video.beschreibung"
              :dauer="video.dauer"
              :kategorien="[video.bereich, video.schwierigkeit].filter(Boolean)"
              :hilfsmittel="video.hilfsmittel"
              :marken="video.oeffentlich && abschnitt.paketId ? ['Frei verfügbar'] : []"
              :ohne-datei="!video.datei"
              :anteil="anteil(video)"
              :erledigt="erledigt(video)"
            />
          </div>

          <GButton
            v-if="abschnitt.paketId && abschnitt.videos.length > JE_ABSCHNITT"
            variant="text"
            :to="{ name: 'paket', params: { id: abschnitt.paketId } }"
          >
            Alle {{ abschnitt.videos.length }} Übungen ansehen →
          </GButton>
        </section>

        <GCard v-if="!auth.isAuthenticated" variant="gradient" class="cta">
          <h2 class="t-h3">Mehr Übungen freischalten</h2>
          <p class="cta-text">
            Mit Ihrem Zugang sehen Sie die Übungen Ihrer gebuchten Pakete — und das Portal merkt
            sich, wo Sie stehengeblieben sind.
          </p>
          <GButton variant="white" :to="{ name: 'login' }">Anmelden</GButton>
        </GCard>

        <p v-if="!abschnitte.length" class="state">
          {{
            auth.isAuthenticated
              ? 'Ihnen sind noch keine Pakete zugewiesen — dadurch gibt es hier noch nichts zu sehen.'
              : 'Es sind noch keine frei verfügbaren Übungen eingestellt.'
          }}
        </p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.home {
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

/* ── Suche und Filter ──────────────────────────────────────────────── */
.filter {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.suchfeld {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 22px;
  border-radius: var(--r-nav);
  background: var(--c-surface);
  max-width: 560px;
}

.suchfeld:focus-within {
  outline: 2px solid var(--c-focus);
  outline-offset: 1px;
}

.lupe {
  color: var(--c-text-muted);
  font-size: 18px;
}

.suchfeld input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-body);
  font-weight: 500;
}

.suchfeld input:focus {
  outline: 0;
}

.chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chip {
  padding: 7px 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-pill);
  background: var(--c-white);
  color: var(--c-text-dark);
  font-family: inherit;
  font-size: var(--fs-secondary);
  cursor: pointer;
}

.chip:hover {
  border-color: var(--c-action);
  color: var(--c-action);
}

.chip.an {
  background: var(--c-dark);
  border-color: var(--c-dark);
  color: var(--c-white);
}

.trenner {
  width: 1px;
  height: 22px;
  background: var(--c-border);
  margin: 0 4px;
}

/* ── Abschnitte ────────────────────────────────────────────────────── */
.abschnitt {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.abschnitt-kopf {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--c-hairline-2);
  padding-bottom: 10px;
}

.abschnitt-kopf a {
  color: var(--c-text);
}

.abschnitt-kopf a:hover {
  color: var(--c-action);
  text-decoration: none;
}

.zaehler {
  flex: none;
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
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 22px;
}

.cta {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
}

.cta-text {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--c-on-dark);
  max-width: 60ch;
}
</style>
