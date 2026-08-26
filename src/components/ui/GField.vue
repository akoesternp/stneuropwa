<script setup lang="ts">
import { computed, useId } from 'vue'

/**
 * Label + Eingabe. Feldmaß:
 *   padding: 15px 20px; border: 1px var(--c-border); border-radius: 15px;
 *   background: weiß; font: 500 18px Instrument Sans
 * Label: Inter 12px Versalien, 8px darüber.
 * Nur-Lese-Felder: Flächengrau, gedämpfter Text.
 */
const props = withDefaults(
  defineProps<{
    label?: string
    modelValue?: string
    /** `select` und `textarea` tauschen das Element; alles andere ist ein <input type>. */
    as?: 'input' | 'select' | 'textarea'
    type?: string
    placeholder?: string
    /** Für Selects: [Wert, Beschriftung]-Paare. */
    options?: readonly (readonly [string, string])[]
    readonly?: boolean
    autocomplete?: string
    required?: boolean
    /** Etwas engeres 14/18-Padding, z. B. in Editor-Formularen. */
    compact?: boolean
  }>(),
  {
    label: undefined,
    modelValue: '',
    as: 'input',
    type: 'text',
    placeholder: undefined,
    options: undefined,
    readonly: false,
    autocomplete: undefined,
    required: false,
    compact: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const id = useId()
const controlClass = computed(() => ['g-control', { compact: props.compact, ro: props.readonly }])

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}
</script>

<template>
  <div class="g-field">
    <label v-if="label" :for="id" class="t-eyebrow">{{ label }}</label>

    <select
      v-if="as === 'select'"
      :id="id"
      :class="controlClass"
      :value="modelValue"
      :required="required"
      @change="onInput"
    >
      <option v-for="[value, text] in options" :key="value" :value="value">{{ text }}</option>
    </select>

    <textarea
      v-else-if="as === 'textarea'"
      :id="id"
      :class="controlClass"
      :value="modelValue"
      :placeholder="placeholder"
      :readonly="readonly"
      :required="required"
      @input="onInput"
    />

    <input
      v-else
      :id="id"
      :class="controlClass"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :readonly="readonly"
      :required="required"
      :autocomplete="autocomplete"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.g-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.g-control {
  width: 100%;
  padding: 15px 20px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-white);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--c-text);
}

.g-control.compact {
  padding: 14px 18px;
}

.g-control.ro {
  background: var(--c-surface);
  color: var(--c-text-muted);
}

.g-control::placeholder {
  color: var(--c-text-faint);
}

textarea.g-control {
  min-height: 104px;
  resize: vertical;
}

select.g-control {
  cursor: pointer;
}
</style>
