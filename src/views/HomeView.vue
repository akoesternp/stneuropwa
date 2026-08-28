<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FilterLeiste from '@/components/FilterLeiste.vue'
import PaketKarte from '@/components/PaketKarte.vue'
import VideoTile from '@/components/VideoTile.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useFortschrittStore } from '@/stores/fortschritt'
import { usePaketeStore } from '@/stores/pakete'
import { useVideosStore } from '@/stores/videos'
import { dauerInSekunden } from '@/utils/format'
import type { KatalogVideo } from '@/types'

/**
 * Die Startseite — zugleich der Katalog.
 *
 * Ohne Filter zeigt sie drei Ebenen untereinander: die frei zugänglichen
 * Übungen, die Zielgruppen und die Pakete. Mit Filter zeigt sie dieselben drei
 * Ebenen, aber nur deren Treffer: ein Merkmal hängt am Video und trägt sich
 * nach oben durch, denn wer nach „Rücken" sucht, will auch das Paket und die
 * Zielgruppe finden, in denen so eine Übung steckt.
 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const videos = useVideosStore()
const pakete = usePaketeStore()
const fortschritt = useFortschrittStore()

const suche = ref('')
const bereichFilter = ref<string[]>([])
const schwierigkeitFilter = ref<string[]>([])

/**
 * Die gewählte Zielgruppe steht in der Adresse (?zielgruppe=…) und nicht in
 * einem eigenen Zustand: damit übersteht die Wahl ein Neuladen, lässt sich
 * verlinken, und der Zurück-Knopf tut das Erwartbare.
 */
const zielgruppe = computed(() => String(route.query.zielgruppe ?? ''))

onMounted(() => {
  void videos.ensureLoaded()
  void pakete.ensureLoaded()
  if (auth.isAuthenticated) void fortschritt.reload()
})

watch(
  () => auth.isAuthenticated,
  (angemeldet) => {
    void videos.reload()
    void pakete.reload()
    if (angemeldet) void fortschritt.reload()
  },
)

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

function waehleZielgruppe(name: string) {
  void router.push({ query: { ...route.query, zielgruppe: name } })
}

function zielgruppeVerlassen() {
  const { zielgruppe: _entfernt, ...rest } = route.query
  void router.push({ query: rest })
}

/*
 * Beim Wechsel der Zielgruppe die Merkmalsfilter zurücksetzen — sonst stünde
 * man im neuen Ausschnitt vor einer leeren Liste, ohne zu sehen, warum. Am
 * Wechsel der Adresse aufgehängt, damit es auch beim Zurück-Knopf greift.
 */
watch(zielgruppe, zuruecksetzen)

const zielgruppeUnbekannt = computed(
  () =>
    videos.loaded &&
    zielgruppe.value !== '' &&
    !videos.zielgruppen.some((eintrag) => eintrag.name === zielgruppe.value),
)

/* ── Der Ausschnitt ──────────────────────────────────────────────────── */

const videosImAusschnitt = computed(() =>
  zielgruppe.value
    ? videos.videos.filter((video) => video.zielgruppenNamen.includes(zielgruppe.value))
    : videos.videos,
)

const paketeImAusschnitt = computed(() =>
  zielgruppe.value
    ? pakete.pakete.filter((paket) => paket.zielgruppenNamen.includes(zielgruppe.value))
    : pakete.pakete,
)

/* ── Filter ──────────────────────────────────────────────────────────── */

/**
 * Was ein Filter prüft. Videos aus der Kachel-Liste und Videos aus einem
 * Paketinhalt sind zwei verschiedene Formen desselben Gegenstands — die
 * gemeinsame Schnittform hält die Regel an einer Stelle.
 */
interface Merkmale {
  titel: string
  untertitel: string
  beschreibung: string
  bereich: string
  schwierigkeit: string
  hilfsmittel: string
}

function passt(eintrag: Merkmale): boolean {
  if (bereichFilter.value.length && !bereichFilter.value.includes(eintrag.bereich)) return false
  if (
    schwierigkeitFilter.value.length &&
    !schwierigkeitFilter.value.includes(eintrag.schwierigkeit)
  ) {
    return false
  }

  const begriff = suche.value.trim().toLowerCase()
  if (!begriff) return true

  // Hilfsmittel bewusst durchsuchbar: „ohne Ball" ist eine echte Frage.
  return [eintrag.titel, eintrag.untertitel, eintrag.beschreibung, eintrag.hilfsmittel]
    .join(' ')
    .toLowerCase()
    .includes(begriff)
}

const trefferVideos = computed(() => videosImAusschnitt.value.filter(passt))

/**
 * Ein Paket passt, wenn eine seiner Übungen passt — auch eine, die dieser
 * Nutzer noch nicht sehen darf. Sonst bliebe ausgerechnet das Paket
 * unauffindbar, das er für dieses Merkmal bräuchte.
 */
const trefferPakete = computed(() =>
  paketeImAusschnitt.value.filter((paket) => paket.videos.some(passt)),
)

/**
 * Eine Zielgruppe passt, wenn eines ihrer Pakete passt oder eine ihr direkt
 * zugeordnete Übung — das Merkmal hängt am Video und trägt sich nach oben.
 */
const trefferZielgruppen = computed(() => {
  if (zielgruppe.value) return []

  const namen = new Set<string>()
  for (const paket of trefferPakete.value) {
    for (const name of paket.zielgruppenNamen) namen.add(name)
  }
  for (const video of trefferVideos.value) {
    for (const name of video.zielgruppenNamen) namen.add(name)
  }

  return videos.zielgruppen.filter((eintrag) => namen.has(eintrag.name))
})

const ohneTreffer = computed(
  () =>
    filterAktiv.value &&
    !trefferZielgruppen.value.length &&
    !trefferPakete.value.length &&
    !trefferVideos.value.length,
)

/* ── Ungefilterte Ansicht ────────────────────────────────────────────── */

/** Die frei zugänglichen Übungen — das Schaufenster. */
const freieVideos = computed(() => videosImAusschnitt.value.filter((video) => video.oeffentlich))

/**
 * Übungen, die der Zielgruppe direkt zugeordnet sind und in keinem ihrer
 * Pakete stecken. Ohne sie hätte die Einzelzuordnung im Backend keinen Weg
 * zum Nutzer.
 */
const einzelneDerZielgruppe = computed(() => {
  if (!zielgruppe.value) return []
  const paketIds = new Set(paketeImAusschnitt.value.map((paket) => paket.id))
  return videosImAusschnitt.value.filter((video) => !video.paketIds.some((id) => paketIds.has(id)))
})

/** Der Umfang einer Zielgruppe: aus den Paketen, nicht aus dem eigenen Stand. */
const umfang = computed(() => {
  const karte = new Map<string, { pakete: number; uebungen: number }>()

  for (const eintrag of videos.zielgruppen) {
    const passende = pakete.pakete.filter((paket) =>
      paket.zielgruppenNamen.includes(eintrag.name),
    )

    // Über die ID entdoppelt: dieselbe Übung kann in zwei Paketen derselben
    // Zielgruppe stecken, gezählt gehört sie einmal.
    const ids = new Set<number>()
    for (const paket of passende) for (const video of paket.videos) ids.add(video.id)

    karte.set(eintrag.name, { pakete: passende.length, uebungen: ids.size })
  }

  return karte
})

/* ── Fortschritt ─────────────────────────────────────────────────────── */

function anteil(video: KatalogVideo): number {
  const stand = fortschritt.fuer(video.id)
  if (!stand?.position) return 0
  const gesamt = dauerInSekunden(video.dauer)
  return gesamt ? stand.position / gesamt : 0
}

function erledigt(video: KatalogVideo): boolean {
  return fortschritt.fuer(video.id)?.erledigt ?? false
}

/** Angefangen, aber weder fertig noch abgehakt. */
const weiterschauen = computed(() => {
  if (!auth.isAuthenticated || zielgruppe.value || filterAktiv.value) return []

  return fortschritt.zuletzt
    .filter((stand) => stand.position > 0 && !stand.erledigt)
    .map((stand) => videos.videos.find((video) => video.id === stand.videoId))
    .filter((video): video is KatalogVideo => Boolean(video))
    .slice(0, 4)
})

/** Was im Übungs-Abschnitt steht, hängt am Zustand der Seite. */
const uebungen = computed(() => {
  if (filterAktiv.value) return trefferVideos.value
  return zielgruppe.value ? einzelneDerZielgruppe.value : freieVideos.value
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
              ? 'Frei zugängliche Übungen, Zielgruppen und alle Pakete.'
              : 'Frei zugängliche Übungen — mehr Inhalte nach der Anmeldung.'
          }}
        </p>
      </div>
    </header>

    <!--
      Ein Merkmal hängt am Video und trägt sich nach oben durch: der Filter
      zeigt deshalb Zielgruppen, Pakete und Übungen zugleich.
    -->
    <FilterLeiste
      v-model:suche="suche"
      v-model:bereiche="bereichFilter"
      v-model:grade="schwierigkeitFilter"
      :verfuegbare-bereiche="videos.bereiche"
    >
      <template #vor>
        <div v-if="zielgruppe" class="ausschnitt">
          <span class="ausschnitt-name">{{ zielgruppe }}</span>
          <button type="button" class="ausschnitt-weg" @click="zielgruppeVerlassen">
            ✕ Alle Zielgruppen
          </button>
        </div>
      </template>
    </FilterLeiste>

    <p v-if="zielgruppeUnbekannt" class="state warn" role="alert">
      Die Zielgruppe „{{ zielgruppe }}" gibt es nicht mehr.
      <button type="button" class="ausschnitt-weg" @click="zielgruppeVerlassen">
        Alle Zielgruppen ansehen
      </button>
    </p>

    <p v-if="videos.error" class="state error" role="alert">{{ videos.error }}</p>
    <p v-else-if="!videos.loaded" class="state">Inhalte werden geladen …</p>

    <template v-else>
      <p v-if="ohneTreffer" class="state">
        Nichts gefunden. Ein anderes Merkmal oder ein kürzerer Suchbegriff hilft meist.
      </p>

      <!-- ── Weiterschauen ─────────────────────────────────────────── -->
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
            :ohne-datei="!video.hatDatei"
            :anteil="anteil(video)"
          />
        </div>
      </section>

      <!-- ── Frei zugängliche Übungen ──────────────────────────────── -->
      <section v-if="!filterAktiv && !zielgruppe && freieVideos.length" class="abschnitt">
        <header class="abschnitt-kopf">
          <h2 class="t-h3">Frei zugängliche Übungen</h2>
          <span class="zaehler t-meta">ohne Freischaltung abspielbar</span>
        </header>

        <div class="grid">
          <VideoTile
            v-for="video in freieVideos"
            :id="video.id"
            :key="video.id"
            :titel="video.titel"
            :untertitel="video.untertitel"
            :beschreibung="video.beschreibung"
            :dauer="video.dauer"
            :kategorien="[video.bereich, video.schwierigkeit].filter(Boolean)"
            :hilfsmittel="video.hilfsmittel"
            :marken="video.paketNamen"
            :ohne-datei="!video.hatDatei"
            :anteil="anteil(video)"
            :erledigt="erledigt(video)"
          />
        </div>
      </section>

      <!-- ── Zielgruppen ───────────────────────────────────────────── -->
      <section
        v-if="!zielgruppe && (filterAktiv ? trefferZielgruppen.length : videos.zielgruppen.length)"
        class="abschnitt"
      >
        <header class="abschnitt-kopf">
          <h2 class="t-h3">Zielgruppen</h2>
          <span class="zaehler t-meta">
            {{ filterAktiv ? 'mit passenden Übungen' : 'Für wen suchen Sie?' }}
          </span>
        </header>

        <div class="zg-karten">
          <button
            v-for="eintrag in filterAktiv ? trefferZielgruppen : videos.zielgruppen"
            :key="eintrag.name"
            type="button"
            class="zg-karte"
            @click="waehleZielgruppe(eintrag.name)"
          >
            <span class="zg-name t-h3">{{ eintrag.name }}</span>
            <span v-if="eintrag.beschreibung" class="zg-text">{{ eintrag.beschreibung }}</span>
            <span v-if="pakete.loaded" class="zg-zahl t-meta">
              {{ umfang.get(eintrag.name)?.pakete ?? 0 }}
              {{ umfang.get(eintrag.name)?.pakete === 1 ? 'Paket' : 'Pakete' }} ·
              {{ umfang.get(eintrag.name)?.uebungen ?? 0 }}
              {{ umfang.get(eintrag.name)?.uebungen === 1 ? 'Übung' : 'Übungen' }}
            </span>
          </button>
        </div>
      </section>

      <!-- ── Pakete ────────────────────────────────────────────────── -->
      <section
        v-if="filterAktiv ? trefferPakete.length : paketeImAusschnitt.length"
        class="abschnitt"
      >
        <header class="abschnitt-kopf">
          <h2 class="t-h3">{{ zielgruppe ? `Pakete für ${zielgruppe}` : 'Pakete' }}</h2>
          <span class="zaehler t-meta">
            {{ (filterAktiv ? trefferPakete : paketeImAusschnitt).length }}
            {{
              (filterAktiv ? trefferPakete : paketeImAusschnitt).length === 1 ? 'Paket' : 'Pakete'
            }}
          </span>
        </header>

        <div class="paket-grid">
          <PaketKarte
            v-for="paket in filterAktiv ? trefferPakete : paketeImAusschnitt"
            :key="paket.id"
            :paket="paket"
          />
        </div>
      </section>

      <!-- ── Übungen (gefiltert bzw. einzelne einer Zielgruppe) ────── -->
      <section v-if="(filterAktiv || zielgruppe) && uebungen.length" class="abschnitt">
        <header class="abschnitt-kopf">
          <h2 class="t-h3">{{ filterAktiv ? 'Übungen' : 'Einzelne Übungen' }}</h2>
          <span class="zaehler t-meta">
            {{ filterAktiv ? `${uebungen.length} gefunden` : 'außerhalb der Pakete' }}
          </span>
        </header>

        <div class="grid">
          <VideoTile
            v-for="video in uebungen"
            :id="video.id"
            :key="video.id"
            :titel="video.titel"
            :untertitel="video.untertitel"
            :beschreibung="video.beschreibung"
            :dauer="video.dauer"
            :kategorien="[video.bereich, video.schwierigkeit].filter(Boolean)"
            :hilfsmittel="video.hilfsmittel"
            :marken="video.paketNamen"
            :gesperrt="!video.freigeschaltet"
            :ohne-datei="!video.hatDatei"
            :anteil="anteil(video)"
            :erledigt="erledigt(video)"
          />
        </div>
      </section>

      <!--
        Bleibt für Gäste immer unten stehen, auch bei gesetztem Filter: gerade
        wer sucht und Gesperrtes findet, hat den Hinweis dann am nötigsten.
      -->
      <GCard v-if="!auth.isAuthenticated" variant="gradient" class="cta">
        <h2 class="t-h3">Mehr Übungen freischalten</h2>
        <p class="cta-text">
          Mit einem Konto merkt sich das Portal Ihren Fortschritt; freigeschaltete Pakete
          erweitern das Angebot.
        </p>
        <div class="cta-knoepfe">
          <GButton variant="white" :to="{ name: 'registrieren' }">Konto anlegen</GButton>
          <GButton variant="white" :to="{ name: 'login' }">Anmelden</GButton>
        </div>
      </GCard>
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

/* Der gewählte Ausschnitt steht als Einschub in der Filterleiste. */
.ausschnitt {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.ausschnitt-name {
  padding: 7px 18px;
  border-radius: var(--r-pill);
  background: var(--c-action);
  color: var(--c-white);
  font-size: var(--fs-secondary);
  font-weight: 500;
}

.ausschnitt-weg {
  border: 0;
  background: transparent;
  color: var(--c-text-muted);
  font-family: inherit;
  font-size: var(--fs-secondary);
  cursor: pointer;
}

.ausschnitt-weg:hover {
  color: var(--c-action);
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

.state.warn {
  color: var(--c-orange);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 22px;
}

/* Etwas schmaler als die Videokacheln — eine Paketkarte trägt weniger. */
.paket-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 22px;
}

/* ── Zielgruppen ───────────────────────────────────────────────────── */
.zg-karten {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.zg-karte {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  text-align: left;
  padding: 22px;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
  font-family: inherit;
  color: var(--c-text);
  cursor: pointer;
}

.zg-karte:hover {
  border-color: var(--c-action);
  background: var(--c-tint);
}

.zg-text {
  font-size: var(--fs-secondary);
  line-height: 1.5;
  color: var(--c-text-muted);
}

.zg-zahl {
  margin-top: auto;
  padding-top: 6px;
  color: var(--c-action);
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

.cta-knoepfe {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
