<script setup lang="ts">
/**
 * Platzhalter-Wortmarke.
 *
 * Sobald ein echtes Logo vorliegt: als SVG nach `src/assets/` legen und das
 * Inline-Markup hier durch ein <img> ersetzen. Seitenverhältnis 132×52 bzw.
 * 108×44 beibehalten, damit Kopfzeile und Login-Hero stimmig bleiben.
 */
withDefaults(defineProps<{ width?: number; height?: number; tone?: 'dark' | 'light' }>(), {
  width: 132,
  height: 52,
  tone: 'dark',
})
</script>

<template>
  <svg
    class="logo"
    :class="tone"
    :width="width"
    :height="height"
    viewBox="0 0 132 52"
    role="img"
    aria-label="stneuro"
    preserveAspectRatio="xMinYMid meet"
  >
    <rect class="mark" x="0" y="3" width="46" height="46" rx="12" />
    <polygon class="mark-play" points="18,17 34,26 18,35" />
    <text class="word" x="56" y="33">stneuro</text>
  </svg>
</template>

<style scoped>
.logo {
  flex: none;
  display: block;
}

.mark {
  fill: var(--c-dark);
}

.mark-play {
  fill: var(--c-white);
}

.word {
  fill: var(--c-dark);
  font-family: var(--font-sans);
  font-size: 21px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* Auf dunklen Flächen invertiert die Marke. */
.light .mark {
  fill: rgba(255, 255, 255, 0.16);
}

.light .mark-play,
.light .word {
  fill: var(--c-white);
}
</style>
