<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Video } from '@/types'

/**
 * Eine Video-Kachel. Der Klick führt zur Abspielseite — ob dort wirklich ein
 * Video läuft, entscheidet der Server; ohne verknüpfte Datei zeigt die Seite
 * „Demnächst verfügbar".
 *
 * Das „Vorschaubild" ist ein Farbverlauf, dessen Ton sich aus der ID ergibt:
 * so sehen die Kacheln unterscheidbar aus, ohne dass es Thumbnails gäbe.
 */
const props = defineProps<{ video: Video }>()

const hue = computed(() => 210 + ((props.video.id * 37) % 90))
const thumbStyle = computed(() => ({
  background: `linear-gradient(135deg,
    hsl(${hue.value}, 45%, 24%),
    hsl(${(hue.value + 40) % 360}, 55%, 45%))`,
}))
</script>

<template>
  <RouterLink class="tile" :to="{ name: 'video', params: { id: video.id } }">
    <div class="thumb" :style="thumbStyle" aria-hidden="true">
      <span class="play">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <polygon points="8,5 19,12 8,19" fill="currentColor" />
        </svg>
      </span>
      <span v-if="!video.datei" class="soon">Demnächst</span>
      <span v-else-if="video.dauer" class="dauer">{{ video.dauer }}</span>
    </div>

    <div class="meta">
      <h3 class="titel t-h3">{{ video.titel }}</h3>
      <p v-if="video.untertitel" class="untertitel">{{ video.untertitel }}</p>
      <span class="pakete">
        <span v-if="!video.paketNamen.length" class="paket t-meta">Frei verfügbar</span>
        <span v-for="name in video.paketNamen" :key="name" class="paket t-meta">{{ name }}</span>
      </span>
    </div>
  </RouterLink>
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

.tile:hover {
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
}

.play {
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

.dauer,
.soon {
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

.soon {
  background: rgba(0, 0, 0, 0.4);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px 20px;
}

.untertitel {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
  line-height: 1.5;
}

/* Ein Video kann in mehreren Paketen liegen — die Marken umbrechen dann. */
.pakete {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.paket {
  padding: 3px 12px;
  border-radius: var(--r-pill);
  background: var(--c-tint);
  color: var(--c-dark);
}
</style>
