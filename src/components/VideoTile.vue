<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

/**
 * Eine Video-Kachel — auf der Startseite wie in der Paketübersicht.
 *
 * Bewusst Einzelwerte statt eines ganzen Video-Objekts: die Paketübersicht
 * gibt weniger Felder heraus als die Kachel-Liste (den Dateinamen etwa nie),
 * und beide sollen trotzdem dieselbe Kachel benutzen.
 *
 * Gesperrte Kacheln zeigen Titel, Untertitel und Beschreibung ganz normal —
 * sie sagen, worum es geht, ohne etwas preiszugeben. Nur der Weg zum Video
 * fehlt; der Stream gäbe es ohnehin nicht heraus.
 */
const props = withDefaults(
  defineProps<{
    id: number
    titel: string
    untertitel?: string
    beschreibung?: string
    dauer?: string
    /** Paketnamen o. Ä. als kleine Marken unter dem Text. */
    marken?: string[]
    /** Nicht freigeschaltet: keine Verknüpfung, Schloss-Marke. */
    gesperrt?: boolean
    /** Noch keine Videodatei hinterlegt. */
    ohneDatei?: boolean
  }>(),
  {
    untertitel: '',
    beschreibung: '',
    dauer: '',
    marken: () => [],
    gesperrt: false,
    ohneDatei: false,
  },
)

/*
 * Das Vorschaubild ist ein Einzelbild aus dem Video und liegt öffentlich —
 * es steht auch an gesperrten Kacheln. Gibt es keines, antwortet der Endpunkt
 * mit 404; dann bleibt der Farbverlauf stehen, statt ein kaputtes Bild zu
 * zeigen.
 */
const bildFehlt = ref(false)
const bildUrl = computed(() => `/api/portal/videos/${props.id}/thumb`)

// Wechselt die Kachel auf ein anderes Video, gilt der Fehlversuch nicht mehr.
watch(() => props.id, () => { bildFehlt.value = false })

const hue = computed(() => 210 + ((props.id * 37) % 90))
const thumbStyle = computed(() => ({
  background: `linear-gradient(135deg,
    hsl(${hue.value}, 45%, 24%),
    hsl(${(hue.value + 40) % 360}, 55%, 45%))`,
}))
</script>

<template>
  <component
    :is="gesperrt ? 'div' : RouterLink"
    :to="gesperrt ? undefined : { name: 'video', params: { id } }"
    class="tile"
    :class="{ gesperrt }"
  >
    <div class="thumb" :style="thumbStyle" aria-hidden="true">
      <img
        v-if="!bildFehlt"
        class="bild"
        :src="bildUrl"
        alt=""
        loading="lazy"
        decoding="async"
        @error="bildFehlt = true"
      />

      <span class="play">
        <svg v-if="gesperrt" viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M7 10V7a5 5 0 0 1 10 0v3"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
          <rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="22" height="22">
          <polygon points="8,5 19,12 8,19" fill="currentColor" />
        </svg>
      </span>

      <span v-if="ohneDatei" class="marke-ecke demnaechst">Demnächst</span>
      <span v-else-if="dauer" class="marke-ecke dauer">{{ dauer }}</span>
    </div>

    <div class="meta">
      <h3 class="titel t-h3">{{ titel }}</h3>
      <p v-if="untertitel" class="untertitel">{{ untertitel }}</p>
      <p v-if="beschreibung" class="beschreibung">{{ beschreibung }}</p>

      <span v-if="marken.length || gesperrt" class="marken">
        <span v-if="gesperrt" class="marke schloss t-meta">Gesperrt</span>
        <span v-for="name in marken" :key="name" class="marke t-meta">{{ name }}</span>
      </span>
    </div>
  </component>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
  overflow: hidden;
  color: var(--c-text);
}

.tile:not(.gesperrt):hover {
  border-color: var(--c-action);
  color: var(--c-text);
  text-decoration: none;
}

.thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* Liegt über dem Farbverlauf, der dadurch zum Rückfall wird. */
.bild {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Gesperrt: gedämpfte Fläche, damit der Unterschied ohne Lesen auffällt. */
.gesperrt .thumb {
  filter: saturate(0.35) brightness(0.85);
}

.play {
  position: relative;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: var(--c-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 3px;
}

.gesperrt .play {
  padding-left: 0;
  background: rgba(255, 255, 255, 0.8);
}

.marke-ecke {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: rgba(0, 0, 0, 0.55);
  color: var(--c-white);
  font-family: var(--font-num);
  font-size: var(--fs-meta);
}

.marke-ecke.demnaechst {
  background: rgba(0, 0, 0, 0.4);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px 20px;
  flex: 1;
}

.untertitel {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
  line-height: 1.5;
}

/*
 * Auf drei Zeilen begrenzt, damit die Kacheln im Raster gleich hoch bleiben —
 * ein langer Text soll das Raster nicht auseinanderziehen.
 */
.beschreibung {
  margin-top: 2px;
  font-size: var(--fs-secondary);
  line-height: 1.55;
  color: var(--c-text-dark);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.marken {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
}

.marke {
  padding: 3px 12px;
  border-radius: var(--r-pill);
  background: var(--c-tint);
  color: var(--c-dark);
}

.marke.schloss {
  background: var(--c-surface);
  color: var(--c-text-muted);
}
</style>
