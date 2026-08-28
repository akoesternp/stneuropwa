<script setup lang="ts">
import { computed } from 'vue'
import GButton from '@/components/ui/GButton.vue'
import { SCHWIERIGKEITEN } from '@shared/types'

/**
 * Suchfeld und Merkmalsfilter — gemeinsam genutzt von der Startseite und der
 * Videoliste.
 *
 * Bewusst eine Komponente statt zweier Abschriften: die beiden Seiten sollen
 * sich gleich anfühlen, und zwei Fassungen derselben Leiste liefen früher oder
 * später auseinander. Die Werte liegen weiterhin bei der Seite — sie entscheidet,
 * was sie damit anstellt.
 */
const suche = defineModel<string>('suche', { required: true })
const bereiche = defineModel<string[]>('bereiche', { required: true })
const grade = defineModel<string[]>('grade', { required: true })

defineProps<{
  /** Die gepflegten Trainingsbereiche, in der Reihenfolge des Backends. */
  verfuegbareBereiche: string[]
  platzhalter?: string
}>()

const aktiv = computed(
  () => suche.value.trim().length > 0 || bereiche.value.length > 0 || grade.value.length > 0,
)

function umschalten(liste: string[], wert: string) {
  const index = liste.indexOf(wert)
  if (index === -1) liste.push(wert)
  else liste.splice(index, 1)
}

function zuruecksetzen() {
  suche.value = ''
  bereiche.value = []
  grade.value = []
}
</script>

<template>
  <div class="filter">
    <!-- Platz für seitenspezifisches, etwa die gewählte Zielgruppe. -->
    <slot name="vor" />

    <label class="suchfeld">
      <span class="visually-hidden">Übungen durchsuchen</span>
      <span class="lupe" aria-hidden="true">⌕</span>
      <input
        v-model="suche"
        type="search"
        :placeholder="platzhalter ?? 'Übung, Beschreibung oder Hilfsmittel suchen …'"
      />
    </label>

    <div class="chips">
      <button
        v-for="bereich in verfuegbareBereiche"
        :key="bereich"
        type="button"
        class="chip"
        :class="{ an: bereiche.includes(bereich) }"
        @click="umschalten(bereiche, bereich)"
      >
        {{ bereich }}
      </button>

      <span v-if="verfuegbareBereiche.length" class="trenner" aria-hidden="true" />

      <button
        v-for="grad in SCHWIERIGKEITEN"
        :key="grad"
        type="button"
        class="chip"
        :class="{ an: grade.includes(grad) }"
        @click="umschalten(grade, grad)"
      >
        {{ grad }}
      </button>

      <GButton v-if="aktiv" variant="text" @click="zuruecksetzen">Zurücksetzen</GButton>
    </div>
  </div>
</template>

<style scoped>
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
</style>
