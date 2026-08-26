<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import GButton from '@/components/ui/GButton.vue'
import { useAuthStore } from '@/stores/auth'
import { useVideosStore } from '@/stores/videos'

/**
 * Die Abspielseite. Das <video>-Element zieht den Stream direkt von der API;
 * das Sitzungscookie geht automatisch mit (gleiche Origin) — Tokens oder
 * signierte Links braucht es deshalb nicht.
 *
 * Die Metadaten kommen aus der Kachel-Liste des Stores. Steht das Video dort
 * nicht drin, darf dieser Aufrufer es nicht sehen (oder es gibt es nicht) —
 * beides bekommt dieselbe Ansicht, denn der Unterschied geht ihn nichts an.
 */
const route = useRoute()
const auth = useAuthStore()
const videos = useVideosStore()

onMounted(() => {
  void videos.ensureLoaded()
})

const video = computed(() =>
  videos.videos.find((eintrag) => eintrag.id === Number(route.params.id)),
)

const streamUrl = computed(() => `/api/portal/videos/${Number(route.params.id)}/stream`)

/** Das Vorschaubild dient als Standbild, bevor jemand auf Abspielen drückt. */
const posterUrl = computed(() => `/api/portal/videos/${Number(route.params.id)}/thumb`)

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
    if (element) player = new Plyr(element, OPTIONEN)
  },
  { flush: 'post' },
)

onBeforeUnmount(loesePlayer)
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
        <GButton variant="outline" size="sm" :to="{ name: 'home' }">Zur Übersicht</GButton>
      </header>

      <!-- Der eigentliche Schutz ist die Berechtigungsprüfung im Stream;
           controlsList nimmt nur den Herunterladen-Knopf aus der Leiste.
           Der Schlüssel sorgt dafür, dass beim Wechsel auf ein anderes Video
           ein frisches Element entsteht — daran hängt der Player neu. -->
      <div v-if="video.datei" class="buehne">
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

      <p v-if="video.beschreibung" class="beschreibung">{{ video.beschreibung }}</p>

      <p class="meta t-meta">
        {{ video.paketNamen.length ? video.paketNamen.join(' · ') : 'Frei verfügbar'
        }}<template v-if="video.dauer"> · {{ video.dauer }}</template>
      </p>
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

.missing-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.beschreibung {
  font-size: var(--fs-body);
  line-height: 1.7;
  color: var(--c-text-dark);
  max-width: 70ch;
}

.meta {
  color: var(--c-text-muted);
}
</style>
