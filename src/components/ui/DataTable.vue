<script setup lang="ts" generic="T">
import { computed } from 'vue'
import type { Column } from '@/types'

/**
 * Jede Datentabelle ist ein CSS-Grid in einer horizontal scrollbaren Karte.
 * Diese Komponente besitzt den Vertrag dazu:
 *
 *   Hülle: overflow-x: auto
 *   Kopf + Zeilen: identische grid-template-columns, identische min-width
 *
 * Die `minmax()`-Untergrenzen und `minWidth` sind tragend — mit nacktem `1fr`
 * kollabiert die erste Spalte auf schmalen Fenstern auf 0px.
 */
const props = withDefaults(
  defineProps<{
    columns: Column[]
    rows: T[]
    /** Zeilenidentität — ein Schlüssel von T oder eine Funktion. Sonst der Index. */
    rowKey?: keyof T | ((row: T) => string | number)
    minWidth: string
    gap?: string
    rowPadding?: string
    headPadding?: string
  }>(),
  {
    rowKey: undefined,
    gap: '14px',
    rowPadding: '14px 24px',
    headPadding: '14px 24px',
  },
)

const hasHeader = computed(() => props.columns.some((column) => column.label))

const gridStyle = computed(() => ({
  gridTemplateColumns: props.columns.map((column) => column.width).join(' '),
  gap: props.gap,
  minWidth: props.minWidth,
}))

function keyFor(row: T, index: number): string | number {
  if (typeof props.rowKey === 'function') return props.rowKey(row)
  if (props.rowKey) return row[props.rowKey] as unknown as string | number
  return index
}
</script>

<template>
  <div class="dt">
    <div
      v-if="hasHeader"
      class="dt-head t-eyebrow"
      :style="{ ...gridStyle, padding: headPadding }"
      role="row"
    >
      <span
        v-for="(column, index) in columns"
        :key="index"
        :style="column.align === 'right' ? { textAlign: 'right' } : undefined"
        >{{ column.label }}</span
      >
    </div>

    <div
      v-for="(row, index) in rows"
      :key="keyFor(row, index)"
      class="dt-row"
      :style="{ ...gridStyle, padding: rowPadding }"
      role="row"
    >
      <slot name="row" :row="row" :index="index" />
    </div>

    <div v-if="!rows.length" class="dt-empty">
      <slot name="empty">Keine Einträge.</slot>
    </div>
  </div>
</template>

<style scoped>
.dt {
  background: var(--c-white);
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  overflow: hidden;
  overflow-x: auto;
}

.dt-head {
  background: var(--c-surface);
  align-items: center;
}

.dt-head,
.dt-row {
  display: grid;
}

.dt-row {
  align-items: center;
  border-bottom: 1px solid var(--c-hairline-3);
}

.dt-empty {
  padding: 26px 24px;
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}
</style>
