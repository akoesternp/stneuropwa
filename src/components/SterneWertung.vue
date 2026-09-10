<script setup lang="ts">
import { computed, ref, useId } from 'vue'

/**
 * Fünf Sterne — als Anzeige oder zum Setzen.
 *
 * Ohne `setzbar` ist es eine reine Auskunft (Kacheln, Listen); mit `setzbar`
 * ein Bedienelement samt Tastaturbedienung. Eine Komponente statt zweier,
 * damit ein Stern überall gleich aussieht.
 */
const props = withDefaults(
  defineProps<{
    /** Was angezeigt wird — Durchschnitt oder eigene Wertung. */
    wert: number
    anzahl?: number
    setzbar?: boolean
    /** Kleine Fassung für Kacheln. */
    klein?: boolean
  }>(),
  { anzahl: 0, setzbar: false, klein: false },
)

const emit = defineEmits<{ setzen: [wert: number] }>()

/** Die Sternform, einmal beschrieben. */
const FORM = 'M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z'

/*
 * Eigene Kennung je Bauteil für die Zuschnitt-Verweise. Ohne sie griffen
 * mehrere Sternleisten auf derselben Seite auf dieselbe Maske zu — dann
 * bestimmte die letzte, wie alle aussehen.
 */
const kennung = useId()

/** Beim Überfahren zeigt sich, was ein Klick bewirkte — 0 = keine Vorschau. */
const vorschau = ref(0)

const gezeigt = computed(() => vorschau.value || props.wert)

/**
 * Wie voll ein einzelner Stern ist (0…1).
 *
 * Anteilig, damit ein Durchschnitt von 3,5 auch als halber Stern erscheint —
 * auf ganze Sterne gerundet ginge genau die Aussage verloren, für die der
 * Durchschnitt da ist.
 */
function fuellung(stelle: number): number {
  return Math.min(Math.max(gezeigt.value - (stelle - 1), 0), 1)
}
</script>

<template>
  <span class="sterne" :class="{ klein, setzbar }">
    <component
      :is="setzbar ? 'button' : 'span'"
      v-for="stelle in 5"
      :key="stelle"
      class="stern"
      :type="setzbar ? 'button' : undefined"
      :aria-label="setzbar ? `${stelle} von 5 Sternen` : undefined"
      :aria-pressed="setzbar ? wert === stelle : undefined"
      @click="setzbar && emit('setzen', stelle)"
      @mouseenter="setzbar && (vorschau = stelle)"
      @mouseleave="setzbar && (vorschau = 0)"
      @focus="setzbar && (vorschau = stelle)"
      @blur="setzbar && (vorschau = 0)"
    >
      <!--
        Zwei Pfade übereinander: der graue immer, der farbige anteilig
        zugeschnitten. So entsteht ein halber Stern ohne zweites Bild.
      -->
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <defs>
          <clipPath :id="`${kennung}-${stelle}`">
            <rect x="0" y="0" :width="20 * fuellung(stelle)" height="20" />
          </clipPath>
        </defs>
        <path class="leer" :d="FORM" />
        <path class="voll" :d="FORM" :clip-path="`url(#${kennung}-${stelle})`" />
      </svg>
    </component>

    <span v-if="anzahl" class="anzahl t-meta">
      {{ wert.toFixed(1).replace('.', ',') }} · {{ anzahl }}
    </span>
    <span v-else-if="!setzbar" class="anzahl t-meta">noch keine Wertung</span>
  </span>
</template>

<style scoped>
.sterne {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.stern {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  line-height: 0;
}

.stern svg {
  width: 20px;
  height: 20px;
}

.klein .stern svg {
  width: 14px;
  height: 14px;
}

.setzbar .stern {
  cursor: pointer;
}

.setzbar .stern:focus-visible {
  outline: 2px solid var(--c-focus);
  outline-offset: 2px;
  border-radius: 3px;
}

.leer {
  fill: var(--c-border);
}

.voll {
  fill: var(--c-orange);
}

.anzahl {
  margin-left: 8px;
  color: var(--c-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
