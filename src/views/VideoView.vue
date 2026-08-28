<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import FreischaltenDialog from '@/components/FreischaltenDialog.vue'
import GButton from '@/components/ui/GButton.vue'
import { useAuthStore } from '@/stores/auth'
import { useCreditsStore } from '@/stores/credits'
import { useFortschrittStore } from '@/stores/fortschritt'
import { useVideosStore } from '@/stores/videos'
import { CREDITS_JE_VIDEO } from '@shared/types'

/**
 * Die Abspielseite. Das <video>-Element zieht den Stream direkt von der API;
 * das Sitzungscookie geht automatisch mit (gleiche Origin) — Tokens oder
 * signierte Links braucht es deshalb nicht.
 *
 * Die Metadaten kommen aus dem Katalog des Stores — der enthält auch, was
 * dieser Aufrufer noch nicht abspielen darf. Solche Übungen zeigen statt des
 * Players den Weg zur Freischaltung; der Stream bliebe ohnehin verschlossen.
 *
 * Steht das Video gar nicht im Katalog, gibt es es nicht (oder es ist nicht im
 * Angebot) — das bekommt dieselbe Ansicht wie ein Tippfehler in der Adresse.
 */
const route = useRoute()
const auth = useAuthStore()
const videos = useVideosStore()
const fortschritt = useFortschrittStore()
const credits = useCreditsStore()

/* ── Freischalten gegen Credits ──────────────────────────────────────── */

const guthaben = computed(() => auth.user?.credits ?? 0)
const reichtDasGuthaben = computed(() => guthaben.value >= CREDITS_JE_VIDEO)

/**
 * Zwischenschritt vor dem Abbuchen.
 *
 * Der Knopf öffnet nur die Rückfrage; gebucht wird erst deren Bestätigung.
 * Wer über die Suche hier gelandet ist, hat oft mehrere ähnliche Übungen
 * offen — der Dialog nennt deshalb den Titel noch einmal.
 */
const frageOffen = ref(false)

async function freischalten(): Promise<void> {
  const erfolg = await credits.kaufe('video', Number(route.params.id))
  // Bei einem Fehler bleibt die Rückfrage stehen: die Meldung steht darin.
  if (erfolg) frageOffen.value = false
}

onMounted(() => {
  // Meldungen eines früheren Kaufs gehören nicht an diese Übung.
  credits.zuruecksetzen()
  void videos.ensureLoaded()
  // Ohne das bleibt der Stand beim direkten Aufruf dieser Seite leer — und
  // damit gäbe es nichts, wohin fortgesetzt werden könnte.
  if (auth.isAuthenticated && !fortschritt.loaded) void fortschritt.reload()
})

const video = computed(() =>
  videos.videos.find((eintrag) => eintrag.id === Number(route.params.id)),
)

const streamUrl = computed(() => `/api/portal/videos/${Number(route.params.id)}/stream`)

/** Das Vorschaubild dient als Standbild, bevor jemand auf Abspielen drückt. */
const posterUrl = computed(() => `/api/portal/videos/${Number(route.params.id)}/thumb`)

/**
 * Die nächste Übung desselben Pakets — beim Training arbeitet man eine Reihe
 * ab, und der Umweg über die Übersicht kostet jedes Mal zwei Klicks.
 *
 * Maßgeblich ist das erste Paket des Videos; liegt es in mehreren, ist das
 * eine Festlegung, aber eine nachvollziehbare.
 */
const naechste = computed(() => {
  const aktuell = video.value
  const paketId = aktuell?.paketIds[0]
  if (!aktuell || paketId === undefined) return null

  const reihe = videos.videos
    .filter((eintrag) => eintrag.paketIds.includes(paketId))
    .sort((a, b) => a.sortierung - b.sortierung || a.id - b.id)

  const stelle = reihe.findIndex((eintrag) => eintrag.id === aktuell.id)
  return stelle >= 0 ? (reihe[stelle + 1] ?? null) : null
})

/**
 * Viele Neuro-Drills laufen 30–60 Sekunden in Schleife. Der Schalter sitzt am
 * Medienelement selbst statt an Plyrs Optionen, damit er sich im Betrieb
 * umlegen lässt, ohne den Player neu aufzubauen.
 */
const wiederholen = ref(false)

/*
 * Der eingebaute Player sieht in jedem Browser anders aus und lässt sich kaum
 * gestalten. Plyr legt eine eigene Bedienleiste über dasselbe <video>-Element
 * — an der Auslieferung ändert das nichts: es bleibt bei einer gewöhnlichen
 * Anfrage an den Stream-Endpunkt samt Sitzungscookie und Range-Requests.
 */
const OPTIONEN: Plyr.Options = {
  controls: [
    'play-large',
    'play',
    'progress',
    'current-time',
    'duration',
    'mute',
    'volume',
    'settings',
    'pip',
    'fullscreen',
  ],
  settings: ['speed'],
  speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
  // Tastatur nur, wenn der Player den Fokus hat — sonst schluckt er die
  // Leertaste auch dann, wenn jemand die Seite bloß herunterscrollen will.
  keyboard: { focused: true, global: false },
  tooltips: { controls: true, seek: true },
  /*
   * Nimmt „Video speichern unter" aus dem Rechtsklick-Menü. Ein Schutz ist das
   * nicht — wer das Video sehen darf, kann den Stream ohnehin abrufen; es
   * verhindert nur das versehentliche Herunterladen.
   */
  disableContextMenu: true,
  i18n: {
    restart: 'Neu starten',
    rewind: '{seektime} s zurück',
    play: 'Abspielen',
    pause: 'Pause',
    fastForward: '{seektime} s vor',
    seek: 'Springen',
    seekLabel: '{currentTime} von {duration}',
    played: 'Abgespielt',
    buffered: 'Geladen',
    currentTime: 'Aktuelle Zeit',
    duration: 'Dauer',
    volume: 'Lautstärke',
    mute: 'Stumm schalten',
    unmute: 'Ton einschalten',
    enterFullscreen: 'Vollbild ein',
    exitFullscreen: 'Vollbild aus',
    frameTitle: 'Player für {title}',
    captions: 'Untertitel',
    settings: 'Einstellungen',
    pip: 'Bild im Bild',
    menuBack: 'Zurück',
    speed: 'Geschwindigkeit',
    normal: 'Normal',
    quality: 'Qualität',
    loop: 'Schleife',
    start: 'Start',
    end: 'Ende',
    all: 'Alle',
    reset: 'Zurücksetzen',
    disabled: 'Aus',
    enabled: 'An',
  },
}

const videoEl = ref<HTMLVideoElement | null>(null)
let player: Plyr | null = null

// Nach der Deklaration von videoEl, sonst greift der Watcher ins Leere.
watch([wiederholen, videoEl], ([an, element]) => {
  if (element) element.loop = an
})

/*
 * Der Stand wird nicht bei jedem Fortschreiten gemeldet — das wären mehrere
 * Anfragen je Sekunde. Alle zehn Sekunden genügt: mehr als diese Spanne kann
 * bei einem Absturz verlorengehen, und beim Anhalten oder Verlassen der Seite
 * wird ohnehin sofort gespeichert.
 */
const MELDE_ABSTAND_MS = 10_000

/** Vor dieser Marke lohnt das Wiederaufnehmen nicht — man fängt eher neu an. */
const MINDEST_POSITION_S = 5

/** So kurz vor dem Ende gilt die Übung als durch; dann wieder von vorn. */
const REST_S = 10

let letzteMeldung = 0

/*
 * Fortsetzen braucht zweierlei: die Metadaten des Videos und den gespeicherten
 * Stand. Beide treffen unabhängig voneinander ein — je nachdem, ob die Seite
 * direkt aufgerufen oder von der Übersicht aus betreten wurde. Deshalb wird
 * nach jedem der beiden Ereignisse geprüft, ob nun beides da ist.
 */
let metadatenDa = false
let fortgesetzt = false

const videoId = computed(() => Number(route.params.id))
const stand = computed(() => fortschritt.fuer(videoId.value))
const erledigt = computed(() => stand.value?.erledigt ?? false)

function melde(position: number, fertig: boolean) {
  if (!auth.isAuthenticated) return
  letzteMeldung = Date.now()
  void fortschritt.melden(videoId.value, position, fertig)
}

/** Haken von Hand — man macht eine Übung auch mal, ohne das Video auszuspielen. */
function erledigtUmschalten() {
  melde(erledigt.value ? (player?.currentTime ?? 0) : 0, !erledigt.value)
}

/** Springt einmalig an die gespeicherte Stelle, sobald beides vorliegt. */
function versucheFortsetzen(instanz: Plyr) {
  if (fortgesetzt || !metadatenDa || !fortschritt.loaded) return
  fortgesetzt = true

  const position = stand.value?.position ?? 0
  const dauer = instanz.duration || 0

  // Nicht wieder aufnehmen, wenn es fast schon durch war — sonst landet man
  // im Abspann und muss von Hand zurückspulen.
  if (position > MINDEST_POSITION_S && (!dauer || position < dauer - REST_S)) {
    instanz.currentTime = position
  }
}

function hefteFortschrittAn(instanz: Plyr) {
  if (!auth.isAuthenticated) return

  instanz.on('loadedmetadata', () => {
    metadatenDa = true
    versucheFortsetzen(instanz)
  })

  instanz.on('timeupdate', () => {
    if (Date.now() - letzteMeldung < MELDE_ABSTAND_MS) return
    melde(instanz.currentTime, erledigt.value)
  })

  instanz.on('pause', () => melde(instanz.currentTime, erledigt.value))
  // Durchgelaufen: als erledigt merken und beim nächsten Mal von vorn.
  instanz.on('ended', () => melde(0, true))
}

function loesePlayer() {
  try {
    player?.destroy()
  } catch {
    // Beim Verlassen der Seite ist das Element unter Umständen schon weg —
    // dann gibt es auch nichts mehr aufzuräumen.
  }
  player = null
}

/*
 * Das Element entsteht erst, wenn die Kachel-Liste geladen ist und ein Video
 * mit Datei gefunden wurde — also nicht beim Einhängen. Deshalb hängt der
 * Player an der Vorlagen-Referenz statt an onMounted.
 */
watch(
  videoEl,
  (element) => {
    loesePlayer()
    metadatenDa = false
    fortgesetzt = false
    if (!element) return
    player = new Plyr(element, OPTIONEN)
    hefteFortschrittAn(player)
  },
  { flush: 'post' },
)

watch(
  () => fortschritt.loaded,
  () => {
    if (player) versucheFortsetzen(player)
  },
)

onBeforeUnmount(() => {
  // Beim Verlassen der Seite den Stand noch mitnehmen — der Zehn-Sekunden-Takt
  // hätte ihn sonst unter Umständen noch nicht gemeldet.
  if (player && auth.isAuthenticated && !player.ended) melde(player.currentTime, erledigt.value)
  loesePlayer()
})
</script>

<template>
  <section class="player">
    <p v-if="!videos.loaded" class="state">Inhalte werden geladen …</p>

    <template v-else-if="video">
      <header class="head">
        <div class="titles">
          <h1 class="t-h2">{{ video.titel }}</h1>
          <p v-if="video.untertitel" class="t-subhead">{{ video.untertitel }}</p>
        </div>
        <div class="kopf-aktionen">
          <GButton
            v-if="auth.isAuthenticated && video.freigeschaltet"
            :variant="erledigt ? 'primary' : 'outline'"
            size="sm"
            @click="erledigtUmschalten"
          >
            {{ erledigt ? '✓ Erledigt' : 'Als erledigt markieren' }}
          </GButton>
          <GButton variant="outline" size="sm" :to="{ name: 'home' }">Zur Übersicht</GButton>
        </div>
      </header>

      <!-- An die Stelle des Sperrhinweises tritt der Player; die Quittung
           sagt, was das gekostet hat. -->
      <p v-if="credits.hinweis" class="quittung" role="status">{{ credits.hinweis }}</p>

      <!--
        Gesperrt: kein Player, aber alles andere bleibt stehen. Titel,
        Beschreibung und der Block „Gehört zu" sind genau das, was jemand
        braucht, der über die Suche hier gelandet ist.
      -->
      <div v-if="!video.freigeschaltet" class="soon">
        <p class="t-h3">Noch nicht freigeschaltet</p>

        <template v-if="auth.isAuthenticated">
          <p class="soon-text">
            Diese Übung kostet
            {{ CREDITS_JE_VIDEO }} {{ CREDITS_JE_VIDEO === 1 ? 'Credit' : 'Credits' }} — Ihr
            Guthaben beträgt {{ guthaben }}. Im Paket ist dieselbe Übung günstiger; unter „Gehört
            zu" steht, zu welchen sie gehört.
          </p>
          <div class="soon-aktionen">
            <GButton
              v-if="reichtDasGuthaben"
              variant="dark"
              :disabled="credits.busy"
              @click="frageOffen = true"
            >
              Für {{ CREDITS_JE_VIDEO }}
              {{ CREDITS_JE_VIDEO === 1 ? 'Credit' : 'Credits' }} freischalten
            </GButton>
            <GButton v-else variant="dark" :to="{ name: 'credits' }">Credits aufladen</GButton>
          </div>
        </template>

        <template v-else>
          <p class="soon-text">
            Diese Übung gehört zu einem Paket, das für Sie noch nicht offen ist. Unter „Gehört zu"
            sehen Sie, über welches Paket und welche Zielgruppe sie zugänglich wird — mit einem
            Konto lässt sie sich für
            {{ CREDITS_JE_VIDEO }} {{ CREDITS_JE_VIDEO === 1 ? 'Credit' : 'Credits' }}
            freischalten.
          </p>
          <div class="soon-aktionen">
            <GButton variant="dark" :to="{ name: 'registrieren' }">Konto anlegen</GButton>
            <GButton variant="outline" :to="{ name: 'login' }">Anmelden</GButton>
          </div>
        </template>

        <p v-if="credits.fehler" class="kauf-fehler" role="alert">{{ credits.fehler }}</p>
      </div>

      <!-- Der eigentliche Schutz ist die Berechtigungsprüfung im Stream;
           controlsList nimmt nur den Herunterladen-Knopf aus der Leiste.
           Der Schlüssel sorgt dafür, dass beim Wechsel auf ein anderes Video
           ein frisches Element entsteht — daran hängt der Player neu. -->
      <div v-else-if="video.hatDatei" class="buehne">
        <video
          :key="video.id"
          ref="videoEl"
          class="video"
          :src="streamUrl"
          :poster="posterUrl"
          controls
          preload="metadata"
          controlslist="nodownload"
        />
      </div>

      <div v-else class="soon">
        <p class="t-h3">Demnächst verfügbar</p>
        <p class="soon-text">
          Zu dieser Kachel ist noch keine Videodatei hinterlegt.
        </p>
      </div>

      <div class="unten">
        <div v-if="video.beschreibung" class="anleitung">
          <h2 class="t-eyebrow">So geht die Übung</h2>
          <p class="beschreibung">{{ video.beschreibung }}</p>
        </div>

        <aside class="steckbrief">
          <h2 class="t-eyebrow">Auf einen Blick</h2>
          <dl class="werte">
            <div v-if="video.bereich"><dt>Bereich</dt><dd>{{ video.bereich }}</dd></div>
            <div v-if="video.schwierigkeit">
              <dt>Schwierigkeit</dt><dd>{{ video.schwierigkeit }}</dd>
            </div>
            <div v-if="video.dauer"><dt>Dauer</dt><dd>{{ video.dauer }}</dd></div>
            <div><dt>Hilfsmittel</dt><dd>{{ video.hilfsmittel || 'keine' }}</dd></div>
          </dl>

          <!--
            Wo diese Übung eingeordnet ist — und zwar begehbar: wer hier
            landet, sucht als Nächstes meist Verwandtes, und der Weg dorthin
            führte sonst über die Übersicht zurück.
          -->
          <div class="zuordnung">
            <span class="t-eyebrow">Gehört zu</span>

            <div v-if="video.zielgruppenNamen.length" class="gruppe">
              <span class="gruppe-titel t-meta">Zielgruppen</span>
              <span class="verweise">
                <RouterLink
                  v-for="name in video.zielgruppenNamen"
                  :key="name"
                  class="verweis zielgruppe"
                  :to="{ name: 'home', query: { zielgruppe: name } }"
                >
                  {{ name }}
                </RouterLink>
              </span>
            </div>

            <div v-if="video.paketNamen.length" class="gruppe">
              <span class="gruppe-titel t-meta">Pakete</span>
              <span class="verweise">
                <!--
                  paketIds und paketNamen kommen vom Server in derselben
                  Reihenfolge — der Index verbindet Name und Ziel.
                -->
                <RouterLink
                  v-for="(name, stelle) in video.paketNamen"
                  :key="name"
                  class="verweis"
                  :to="{ name: 'paket', params: { id: video.paketIds[stelle] } }"
                >
                  {{ name }}
                </RouterLink>
              </span>
            </div>

            <p v-if="video.oeffentlich" class="frei t-meta">
              Frei zugänglich — auch ohne Anmeldung abspielbar.
            </p>

            <p
              v-else-if="!video.zielgruppenNamen.length && !video.paketNamen.length"
              class="frei t-meta"
            >
              Einzeln für Sie freigeschaltet.
            </p>
          </div>

          <label v-if="video.freigeschaltet && video.hatDatei" class="schleife">
            <input v-model="wiederholen" type="checkbox" />
            In Schleife wiederholen
          </label>

          <GButton
            v-if="naechste"
            variant="dark"
            :to="{ name: 'video', params: { id: naechste.id } }"
          >
            Nächste Übung →
          </GButton>
        </aside>
      </div>

    </template>

    <div v-else class="missing">
      <p class="t-h3">Dieses Video ist hier nicht verfügbar.</p>
      <p class="soon-text">
        {{
          auth.isAuthenticated
            ? 'Es gehört zu keinem Ihrer Pakete — oder es existiert nicht.'
            : 'Möglicherweise wird es nach der Anmeldung sichtbar.'
        }}
      </p>
      <div class="missing-actions">
        <GButton v-if="!auth.isAuthenticated" :to="{ name: 'login' }">Anmelden</GButton>
        <GButton variant="outline" :to="{ name: 'home' }">Zur Übersicht</GButton>
      </div>
    </div>

    <FreischaltenDialog
      v-if="video"
      :offen="frageOffen"
      art="Übung"
      :name="video.titel"
      :zusatz="[video.bereich, video.dauer].filter(Boolean).join(' · ')"
      :kosten="CREDITS_JE_VIDEO"
      :guthaben="guthaben"
      :busy="credits.busy"
      :fehler="credits.fehler"
      @bestaetigen="freischalten"
      @abbrechen="frageOffen = false"
    />
  </section>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
  max-width: 1100px;
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

.kopf-aktionen {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.state {
  font-size: var(--fs-body);
  color: var(--c-subhead);
}

/*
 * Die Plyr-Bedienleiste entsteht zur Laufzeit und trägt deshalb keine
 * Scope-Kennung dieser Komponente. CSS-Variablen vererben sich aber auch
 * dorthin — die Gestaltung läuft darum über Variablen auf dem Rahmen und
 * nicht über Regeln auf Plyrs eigenen Klassen.
 */
.buehne {
  --plyr-color-main: var(--c-action);
  --plyr-font-family: var(--font-sans);
  --plyr-font-size-small: var(--fs-meta);
  --plyr-font-size-base: var(--fs-secondary);
  --plyr-font-weight-regular: 500;
  --plyr-video-background: var(--c-dark);
  --plyr-video-control-color: rgb(255, 255, 255);
  --plyr-video-control-color-hover: rgb(255, 255, 255);
  --plyr-video-control-background-hover: var(--c-action);
  --plyr-control-spacing: 12px;
  --plyr-range-track-height: 6px;
  --plyr-range-thumb-height: 14px;
  --plyr-tooltip-background: var(--c-dark);
  --plyr-tooltip-color: rgb(255, 255, 255);
  --plyr-tooltip-radius: 8px;
  --plyr-menu-background: var(--c-white);
  --plyr-menu-color: var(--c-text);
  --plyr-menu-radius: 12px;
  --plyr-badge-background: var(--c-dark);
  --plyr-focus-visible-color: var(--c-focus);

  border-radius: var(--r-card);
  overflow: hidden;
  background: var(--c-dark);
}

.video {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--c-dark);
  display: block;
}

/* Der Player übernimmt das Seitenverhältnis vom Video selbst. */
.buehne :deep(.plyr) {
  border-radius: var(--r-card);
}

.buehne :deep(.plyr__poster) {
  background-size: cover;
}

.soon,
.missing {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  padding: 40px;
  border-radius: var(--r-card);
  background: var(--c-surface);
}

.soon-text {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
  line-height: 1.6;
}

.quittung {
  font-size: var(--fs-secondary);
  color: var(--c-action);
}

.kauf-fehler {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

.soon-aktionen,
.missing-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
}

/*
 * Anleitung und Steckbrief nebeneinander: beim Üben schaut man auf das Video
 * und liest daneben mit, statt darunter zu scrollen. Unter 900 px stapelt es.
 */
.unten {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .unten {
    grid-template-columns: 1fr;
  }
}

.anleitung {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.beschreibung {
  font-size: var(--fs-body);
  line-height: 1.7;
  color: var(--c-text-dark);
  max-width: 70ch;
}

.steckbrief {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
  padding: 20px;
  border-radius: var(--r-card);
  background: var(--c-surface);
}

.werte {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.werte > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-secondary);
}

.werte dt {
  color: var(--c-text-muted);
}

.werte dd {
  margin: 0;
  font-weight: 500;
  text-align: right;
}

/* ── Zuordnung ─────────────────────────────────────────────────────── */
.zuordnung {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding-top: 12px;
  border-top: 1px solid var(--c-hairline);
}

.gruppe {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gruppe-titel {
  color: var(--c-text-muted);
}

.verweise {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.verweis {
  padding: 4px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-pill);
  background: var(--c-white);
  font-size: var(--fs-secondary);
  color: var(--c-text-dark);
}

.verweis:hover {
  border-color: var(--c-action);
  color: var(--c-action);
  text-decoration: none;
}

/* Die oberste Ebene etwas kräftiger als die Pakete darunter. */
.verweis.zielgruppe {
  border-color: var(--c-action);
  color: var(--c-action);
}

.verweis.zielgruppe:hover {
  background: var(--c-action);
  color: var(--c-white);
}

.frei {
  color: var(--c-text-muted);
}

.schleife {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: var(--fs-secondary);
}

.schleife input {
  width: 16px;
  height: 16px;
  accent-color: var(--c-action);
}

</style>
