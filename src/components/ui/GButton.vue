<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

/**
 * Der eine Button der Gestaltung. Grundmaß:
 *   padding: 15px 30px; border-radius: 50px; font: 500 18px; line-height: 1; border: 0
 * Kleine Variante (Tabellenaktionen, Chips): padding: 8px 18px; font-size: 14px
 */
type Variant =
  | 'primary' /* Aktionsblau → Dunkelblau beim Hover */
  | 'dark' /* Dunkelblau → Aktionsblau beim Hover */
  | 'outline' /* weiß + Rand → blauer Rand & Text */
  | 'ghost' /* Tint-Chip → Aktionsblau + weißer Text */
  | 'white' /* auf Verlaufsflächen → Aktionsblau + weißer Text */
  | 'text' /* randlose blaue Beschriftung */

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: 'md' | 'sm'
    /** Rendert einen <RouterLink> statt eines <button>. */
    to?: RouteLocationRaw
    type?: 'button' | 'submit'
    disabled?: boolean
    danger?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    to: undefined,
    type: 'button',
    disabled: false,
    danger: false,
  },
)

const tag = computed(() => (props.to ? RouterLink : 'button'))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :type="to ? undefined : type"
    :disabled="to ? undefined : disabled"
    class="g-btn"
    :class="[`v-${variant}`, `s-${size}`, { danger }]"
  >
    <slot />
  </component>
</template>

<style scoped>
.g-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 0;
  border-radius: var(--r-pill);
  font-family: var(--font-sans);
  font-weight: 500;
  line-height: 1;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}

.g-btn:hover {
  text-decoration: none;
}

.g-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

/* ── Größen ────────────────────────────────────────────────────────── */
.s-md {
  padding: 15px 30px;
  font-size: var(--fs-body);
}

.s-sm {
  padding: 8px 18px;
  font-size: var(--fs-secondary);
}

/* ── Varianten ─────────────────────────────────────────────────────── */
.v-primary {
  background: var(--c-action);
  color: var(--c-white);
}

.v-primary:not(:disabled):hover {
  background: var(--c-dark);
  color: var(--c-white);
}

.v-dark {
  background: var(--c-dark);
  color: var(--c-white);
}

.v-dark:not(:disabled):hover {
  background: var(--c-action);
  color: var(--c-white);
}

.v-outline {
  background: var(--c-white);
  border: 1px solid var(--c-border);
  color: var(--c-text);
}

.v-outline:not(:disabled):hover {
  border-color: var(--c-action);
  color: var(--c-action);
}

.v-outline.danger:not(:disabled):hover {
  border-color: var(--c-red);
  color: var(--c-red);
}

.v-ghost {
  background: var(--c-tint);
  color: var(--c-dark);
}

.v-ghost:not(:disabled):hover {
  background: var(--c-action);
  color: var(--c-white);
}

.v-white {
  background: var(--c-white);
  color: var(--c-text);
}

.v-white:not(:disabled):hover {
  background: var(--c-action);
  color: var(--c-white);
}

.v-text {
  padding: 0;
  background: transparent;
  color: var(--c-action);
}

.v-text:not(:disabled):hover {
  color: var(--c-dark);
}
</style>
