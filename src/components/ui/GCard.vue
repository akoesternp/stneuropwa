<script setup lang="ts">
/**
 * Flächen-Primitive. Alle Karten teilen Radius 15; die Variante wählt die Füllung.
 *   white    — 1px Haarlinien-Rand
 *   grey     — Flächengrau, ohne Rand
 *   gradient — der Signatur-Verlauf, weißer Text
 */
withDefaults(
  defineProps<{
    variant?: 'white' | 'grey' | 'gradient'
    /** Innenabstand; Standard 26px. */
    pad?: string
    /** Auf false, wenn die Karte eine Tabelle hält, die ihren Abstand selbst besitzt. */
    padded?: boolean
  }>(),
  { variant: 'white', pad: 'var(--card-pad)', padded: true },
)
</script>

<template>
  <div class="g-card" :class="variant" :style="padded ? { padding: pad } : undefined">
    <slot />
  </div>
</template>

<style scoped>
.g-card {
  border-radius: var(--r-card);
  min-width: 0;
}

.white {
  background: var(--c-white);
  border: 1px solid var(--c-hairline);
}

.grey {
  background: var(--c-surface);
}

.gradient {
  background: var(--gradient);
  color: var(--c-white);
}

/*
 * Nackte Links auf dem Verlauf invertieren zu weiß. GButton rendert ein <a>,
 * sobald er ein `to` hat, und muss ausgenommen bleiben — sonst schlägt diese
 * Regel die Button-Variante und malt weiße Schrift auf die weiße Pille.
 */
.gradient :deep(a:not(.g-btn)) {
  color: var(--c-white);
}
</style>
