<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { Column } from '@/types'

/** Die Backend-Zugänge — wer die Verwaltung bedienen darf. */
interface Zugang {
  benutzer: string
  name: string
}

const auth = useAuthStore()

const rows = ref<Zugang[]>([])
const defaults = ref<string[]>([])
const editing = ref<Zugang | null>(null)
const newPassword = ref('')
const repeatPassword = ref('')
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

const columns: Column[] = [
  { label: 'Benutzer', width: 'minmax(160px,1fr)' },
  { label: 'Name', width: 'minmax(180px,1fr)' },
  { label: 'Passwort', width: '190px' },
  { width: '220px' },
]

const isNew = computed(
  () => editing.value !== null && !rows.value.some((r) => r.benutzer === editing.value!.benutzer),
)

async function load() {
  rows.value = await api.get<Zugang[]>('/admin/admins')
  const health = await api.get<{ defaultPasswordAdmins: string[] }>('/admin/health')
  defaults.value = health.defaultPasswordAdmins ?? []
}

onMounted(load)

function usesDefault(row: Zugang): boolean {
  return defaults.value.includes(row.benutzer)
}

function startNew() {
  notice.value = null
  error.value = null
  newPassword.value = ''
  repeatPassword.value = ''
  editing.value = { benutzer: '', name: '' }
}

function startEdit(row: Zugang) {
  notice.value = null
  error.value = null
  newPassword.value = ''
  repeatPassword.value = ''
  editing.value = { ...row }
}

async function save() {
  if (!editing.value) return
  const key = editing.value.benutzer.trim()

  if (!key) {
    error.value = 'Benutzername ist Pflicht.'
    return
  }
  if (isNew.value && !newPassword.value) {
    error.value = 'Für einen neuen Zugang wird ein Passwort benötigt.'
    return
  }
  // Tippfehler in einem Nur-Schreiben-Feld fallen sonst erst bei der nächsten Anmeldung auf.
  if (newPassword.value && newPassword.value !== repeatPassword.value) {
    error.value = 'Die beiden Passwörter stimmen nicht überein.'
    return
  }

  busy.value = true
  error.value = null
  try {
    await api.put(`/admin/admins/${encodeURIComponent(key)}`, {
      name: editing.value.name,
      passwort: newPassword.value,
    })
    await load()
    notice.value =
      newPassword.value && key === auth.adminUser
        ? 'Ihr Passwort wurde geändert. Es gilt ab der nächsten Anmeldung.'
        : `${key} gespeichert.`
    editing.value = null
    newPassword.value = ''
    repeatPassword.value = ''
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Speichern fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: Zugang) {
  if (!confirm(`Backend-Zugang „${row.benutzer}" wirklich löschen?`)) return
  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/admins/${encodeURIComponent(row.benutzer)}`)
    await load()
    notice.value = `${row.benutzer} gelöscht.`
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Löschen fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="page">
    <header class="head">
      <div class="titles">
        <h2 class="t-h2">Backend-Zugänge</h2>
        <p class="t-subhead">
          Wer die Verwaltung bedienen darf. Passwörter sind nur setzbar, nicht lesbar.
        </p>
      </div>
      <GButton @click="startNew">Neuer Zugang</GButton>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <p v-if="defaults.length" class="warn" role="alert">
      {{ defaults.join(', ') }} nutzt noch das Standardpasswort aus der Ersteinrichtung. Bitte
      jetzt ändern — bis dahin kommt jeder in die Verwaltung, der die Anleitung kennt.
    </p>

    <GCard v-if="editing" class="editor">
      <h3 class="t-h3">{{ isNew ? 'Neuer Zugang' : `Zugang ${editing.benutzer}` }}</h3>

      <div class="fields">
        <GField v-model="editing.benutzer" label="Benutzer" :readonly="!isNew" compact />
        <GField v-model="editing.name" label="Name" compact />
        <GField
          v-model="newPassword"
          label="Neues Passwort"
          type="password"
          autocomplete="new-password"
          compact
          :placeholder="isNew ? 'Pflicht' : 'leer lassen = unverändert'"
        />
        <GField
          v-model="repeatPassword"
          label="Passwort wiederholen"
          type="password"
          autocomplete="new-password"
          compact
        />
      </div>

      <div class="editor-actions">
        <GButton :disabled="busy" @click="save">Speichern</GButton>
        <GButton variant="outline" :disabled="busy" @click="editing = null">Abbrechen</GButton>
      </div>
    </GCard>

    <DataTable :columns="columns" :rows="rows" row-key="benutzer" min-width="760px">
      <template #row="{ row }">
        <span class="name">
          {{ row.benutzer }}
          <span v-if="row.benutzer === auth.adminUser" class="t-meta self">Sie</span>
        </span>
        <span class="muted">{{ row.name || '—' }}</span>
        <span :class="usesDefault(row) ? 'flag' : 'ok'">
          {{ usesDefault(row) ? 'Standardpasswort' : 'individuell' }}
        </span>
        <div class="row-actions">
          <GButton variant="ghost" size="sm" @click="startEdit(row)">
            {{ row.benutzer === auth.adminUser ? 'Passwort ändern' : 'Bearbeiten' }}
          </GButton>
          <GButton
            v-if="row.benutzer !== auth.adminUser && rows.length > 1"
            variant="outline"
            size="sm"
            danger
            @click="remove(row)"
          >
            Löschen
          </GButton>
        </div>
      </template>

      <template #empty>Keine Backend-Zugänge vorhanden.</template>
    </DataTable>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 22px;
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

.notice {
  font-size: var(--fs-secondary);
  color: var(--c-positive);
}

.error {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

.warn {
  padding: 14px 20px;
  border-radius: var(--r-card);
  background: var(--c-orange);
  color: var(--c-white);
  font-size: var(--fs-secondary);
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.editor-actions {
  display: flex;
  gap: 12px;
}

.name {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-body);
  font-weight: 500;
}

.self {
  padding: 2px 10px;
  border-radius: var(--r-pill);
  background: var(--c-tint);
  color: var(--c-dark);
}

.muted {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.flag {
  font-size: var(--fs-secondary);
  color: var(--c-orange);
}

.ok {
  font-size: var(--fs-secondary);
  color: var(--c-positive);
}

.row-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
