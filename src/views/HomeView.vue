<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PaketKarte from '@/components/PaketKarte.vue'
import VideoTile from '@/components/VideoTile.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useFortschrittStore } from '@/stores/fortschritt'
import { usePaketeStore } from '@/stores/pakete'
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
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const videos = useVideosStore()
const pakete = usePaketeStore()
const fortschritt = useFortschrittStore()

/** So viele Kacheln je Abschnitt; der Rest steht auf der Paketseite. */
const JE_ABSCHNITT = 8

const suche = ref('')
/**
 * Die Zielgruppe ist keine Filterschaltfläche, sondern der Einstieg: Solange
 * keine gewählt ist, zeigt die Seite, welche es gibt. Erst danach erscheinen
 * die gewohnten Filter — und suchen innerhalb dieses Ausschnitts.
 *
 * Bewusst nur EINE: „für wen ist das" hat eine Antwort, keine Menge.
 *
 * Sie steht in der Adresse (?zielgruppe=…) und nicht in einem eigenen Zustand:
 * damit übersteht die Wahl ein Neuladen, lässt sich verlinken, und der
 * Zurück-Knopf des Browsers tut das Erwartbare. Die Adresse ist die einzige
 * Quelle — so kann nichts auseinanderlaufen.
 */
const zielgruppe = computed(() => String(route.query.zielgruppe ?? ''))
const bereichFilter = ref<string[]>([])
const schwierigkeitFilter = ref<string[]>([])

onMounted(() => {
  void videos.ensureLoaded()
  // Für die Paketkarten in einer Zielgruppe — auch Gäste sehen sie.
  void pakete.ensureLoaded()
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
    void pakete.reload()
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

/** Zurück zur Auswahl — dabei fallen auch die Filter darunter weg. */
function zielgruppeVerlassen() {
  const { zielgruppe: _entfernt, ...rest } = route.query
  void router.push({ query: rest })
}

function waehleZielgruppe(name: string) {
  void router.push({ query: { ...route.query, zielgruppe: name } })
}

/*
 * Beim Wechsel der Zielgruppe die Merkmalsfilter zurücksetzen — sonst stünde
 * man im neuen Ausschnitt vor einer leeren Liste, ohne zu sehen, warum. Am
 * Wechsel der Adresse aufgehängt, damit es auch beim Zurück-Knopf greift.
 */
watch(zielgruppe, zuruecksetzen)

/**
 * Eine Zielgruppe, die es nicht (mehr) gibt — etwa aus einem alten Lesezeichen
 * oder nach dem Umbenennen. Ohne Hinweis stünde man vor einer leeren Seite und
 * hielte den Bestand für leer.
 */
const zielgruppeUnbekannt = computed(
  () =>
    videos.loaded &&
    zielgruppe.value !== '' &&
    !videos.zielgruppen.some((eintrag) => eintrag.name === zielgruppe.value),
)

/** Der Ausschnitt, in dem alles Weitere stattfindet. */
const imAusschnitt = computed(() =>
  zielgruppe.value
    ? videos.videos.filter((video) => video.zielgruppenNamen.includes(zielgruppe.value))
    : videos.videos,
)

/**
 * Die Pakete der gewählten Zielgruppe — dargestellt wie in der Paketübersicht,
 * samt „freigeschaltet" oder nicht.
 *
 * Sie kommen aus der Paketübersicht und nicht aus den sichtbaren Videos: ein
 * Paket, von dem der Nutzer noch nichts sehen darf, hätte dort gar keine
 * Spur — und genau dieses Paket ist das, auf das man ihn hinweisen will.
 */
const paketeDerZielgruppe = computed(() =>
  zielgruppe.value
    ? pakete.pakete.filter((paket) => paket.zielgruppenNamen.includes(zielgruppe.value))
    : [],
)

/**
 * Übungen, die dieser Zielgruppe direkt zugeordnet sind — also nicht über
 * eines ihrer Pakete hereinkommen.
 *
 * In einer Zielgruppe führen sonst die Pakete durch den Inhalt; nur diese
 * Einzelstücke hätten sonst keinen Weg zum Nutzer, und die Zuordnung im
 * Backend wäre wirkungslos.
 */
const einzelneDerZielgruppe = computed(() => {
  if (!zielgruppe.value) return []
  const paketIds = new Set(paketeDerZielgruppe.value.map((paket) => paket.id))

  return imAusschnitt.value.filter((video) => !video.paketIds.some((id) => paketIds.has(id)))
})

/**
 * Der Umfang einer Zielgruppe für die Karten — bewusst aus den PAKETEN und
 * nicht aus den sichtbaren Übungen.
 *
 * Vorher zählte hier, was der Nutzer schon darf; wer nichts freigeschaltet
 * hat, las an jeder Karte „0 Übungen" und hielt die Zielgruppe für leer. Die
 * Karte soll aber den Umfang des Angebots zeigen, nicht den eigenen Stand.
 * Paketinhalte sind ohnehin öffentlich beschrieben.
 */
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

const treffer = computed(() => {
  const begriff = suche.value.trim().toLowerCase()

  return imAusschnitt.value.filter((video) => {
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

  for (const video of imAusschnitt.value) {
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

<!--
      Der Einstieg: Solange keine Zielgruppe gewählt ist, zeigt die Seite,
      welche es gibt. Das beantwortet „für wen ist das hier" vor „welche Übung
      suche ich" — bei einem großen Bestand die nützlichere Reihenfolge.
    -->
    <section v-if="!zielgruppe && videos.zielgruppen.length && videos.loaded" class="zielgruppen">
      <header class="abschnitt-kopf">
        <h2 class="t-h3">Für wen suchen Sie?</h2>
        <span class="zaehler t-meta">Wählen Sie eine Zielgruppe — oder scrollen Sie weiter</span>
      </header>

      <div class="zg-karten">
        <button
          v-for="eintrag in videos.zielgruppen"
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

    <!-- Suche und Filter: erst innerhalb einer Zielgruppe die volle Leiste. -->
    <div class="filter">
      <div v-if="zielgruppe" class="ausschnitt">
        <span class="ausschnitt-name">{{ zielgruppe }}</span>
        <button type="button" class="ausschnitt-weg" @click="zielgruppeVerlassen">
          ✕ Alle Zielgruppen
        </button>
      </div>

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

        <GButton v-if="filterAktiv" variant="text" @click="zuruecksetzen">
          Zurücksetzen
        </GButton>
      </div>
    </div>

    <p v-if="zielgruppeUnbekannt" class="state warn" role="alert">
      Die Zielgruppe „{{ zielgruppe }}" gibt es nicht mehr.
      <button type="button" class="ausschnitt-weg" @click="zielgruppeVerlassen">
        Alle Zielgruppen ansehen
      </button>
    </p>

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
        <!--
          In einer Zielgruppe zuerst deren Pakete — auch die noch nicht
          freigeschalteten. Sonst sähe man nur die eigenen Übungen und nicht,
          was es hier überhaupt gibt.
        -->
        <section v-if="paketeDerZielgruppe.length" class="abschnitt">
          <header class="abschnitt-kopf">
            <h2 class="t-h3">Pakete für {{ zielgruppe }}</h2>
            <span class="zaehler t-meta">
              {{ paketeDerZielgruppe.length }}
              {{ paketeDerZielgruppe.length === 1 ? 'Paket' : 'Pakete' }}
            </span>
          </header>

          <div class="paket-grid">
            <PaketKarte v-for="paket in paketeDerZielgruppe" :key="paket.id" :paket="paket" />
          </div>
        </section>

        <section v-if="!zielgruppe && weiterschauen.length" class="abschnitt">
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

        <!--
          In einer Zielgruppe führen die Pakete durch den Inhalt — die
          Gliederung nach eigenen Paketen und freien Übungen bliebe daneben
          eine zweite, verwirrende Sicht auf dieselben Kacheln.
        -->
        <section
          v-for="abschnitt in zielgruppe ? [] : abschnitte"
          :key="abschnitt.schluessel"
          class="abschnitt"
        >
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

        <section v-if="zielgruppe && einzelneDerZielgruppe.length" class="abschnitt">
          <header class="abschnitt-kopf">
            <h2 class="t-h3">Einzelne Übungen</h2>
            <span class="zaehler t-meta">
              {{ einzelneDerZielgruppe.length }}
              {{ einzelneDerZielgruppe.length === 1 ? 'Übung' : 'Übungen' }} außerhalb der Pakete
            </span>
          </header>

          <div class="grid">
            <VideoTile
              v-for="video in einzelneDerZielgruppe"
              :id="video.id"
              :key="video.id"
              :titel="video.titel"
              :untertitel="video.untertitel"
              :beschreibung="video.beschreibung"
              :dauer="video.dauer"
              :kategorien="[video.bereich, video.schwierigkeit].filter(Boolean)"
              :hilfsmittel="video.hilfsmittel"
              :ohne-datei="!video.datei"
              :anteil="anteil(video)"
              :erledigt="erledigt(video)"
            />
          </div>
        </section>

        <p v-if="zielgruppe && !paketeDerZielgruppe.length && !einzelneDerZielgruppe.length" class="state">
          Zu dieser Zielgruppe ist noch nichts hinterlegt.
        </p>

        <GCard v-if="!auth.isAuthenticated" variant="gradient" class="cta">
          <h2 class="t-h3">Mehr Übungen freischalten</h2>
          <p class="cta-text">
            Mit Ihrem Zugang sehen Sie die Übungen Ihrer gebuchten Pakete — und das Portal merkt
            sich, wo Sie stehengeblieben sind.
          </p>
          <GButton variant="white" :to="{ name: 'login' }">Anmelden</GButton>
        </GCard>

        <p v-if="!zielgruppe && !abschnitte.length" class="state">
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

/* ── Zielgruppen-Einstieg ──────────────────────────────────────────── */
.zielgruppen {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

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

/* Der gewählte Ausschnitt, über der Filterleiste. */
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
