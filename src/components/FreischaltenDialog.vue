<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import GButton from '@/components/ui/GButton.vue'

/**
 * Die Rückfrage vor dem Abbuchen.
 *
 * Freischalten kostet echtes Guthaben und lässt sich nicht rückgängig machen —
 * ein einzelner Klick ist dafür zu wenig. Der Dialog nennt deshalb den Namen
 * der Übung bzw. des Pakets ausdrücklich: der häufigste Fehlgriff ist nicht
 * „ich wollte gar nichts kaufen", sondern „ich war auf der falschen Kachel".
 *
 * Ein natives <dialog>: Fokusfalle, Escape und stillgelegter Hintergrund
 * kommen mit, statt von Hand nachgebaut zu werden.
 */
const props = defineProps<{
  offen: boolean
  /** 'Übung' oder 'Paket' — steht in der Überschrift. */
  art: string
  /** Der Name dessen, was freigeschaltet wird. Wörtlich, damit man ihn prüft. */
  name: string
  /** Zusatzzeile, etwa „7 Übungen · 42:10 Laufzeit". */
  zusatz?: string
  kosten: number
  guthaben: number
  busy?: boolean
  fehler?: string | null
}>()

const emit = defineEmits<{ bestaetigen: []; abbrechen: [] }>()

const dialogEl = ref<HTMLDialogElement | null>(null)

watch(
  () => props.offen,
  (offen) => {
    const dialog = dialogEl.value
    if (!dialog) return
    if (offen && !dialog.open) dialog.showModal()
    if (!offen && dialog.open) dialog.close()
    document.body.style.overflow = offen ? 'hidden' : ''
  },
  { flush: 'post' },
)

// Die Scroll-Sperre nicht zurücklassen, wenn die Seite darunter wechselt.
onBeforeUnmount(() => {
  document.body.style.overflow = ''
})

function abbrechen() {
  // Während der Buchung nicht schließen: die Antwort gehört noch hierher.
  if (props.busy) return
  emit('abbrechen')
}

/** Ein Klick daneben trifft das dialog-Element selbst, nicht seinen Inhalt. */
function onHintergrundKlick(event: MouseEvent) {
  if (event.target === dialogEl.value) abbrechen()
}
</script>

<template>
  <!--
    Escape schließt nicht selbst, sondern meldet nach oben: offen/zu entscheidet
    die Seite. `.prevent` hält den Dialog auch während einer laufenden Buchung.
  -->
  <dialog ref="dialogEl" class="dialog" @cancel.prevent="abbrechen" @click="onHintergrundKlick">
    <div class="inner">
      <h2 class="t-h3">{{ art }} freischalten?</h2>

      <p class="gegenstand">{{ name }}</p>
      <p v-if="zusatz" class="zusatz t-meta">{{ zusatz }}</p>

      <!--
        Vorher/nachher statt nur des Preises: die Frage vor dem Klick ist
        „was bleibt mir danach", und die soll niemand im Kopf rechnen müssen.
      -->
      <dl class="rechnung">
        <div>
          <dt>Kosten</dt>
          <dd>{{ kosten }} {{ kosten === 1 ? 'Credit' : 'Credits' }}</dd>
        </div>
        <div>
          <dt>Guthaben danach</dt>
          <dd>{{ guthaben }} → {{ Math.max(0, guthaben - kosten) }}</dd>
        </div>
      </dl>

      <p class="hinweis t-meta">
        Freigeschaltet bleibt es dauerhaft. Abgebuchte Credits lassen sich nicht zurückholen.
      </p>

      <p v-if="fehler" class="fehler" role="alert">{{ fehler }}</p>

      <footer class="knoepfe">
        <GButton variant="dark" :disabled="busy" @click="emit('bestaetigen')">
          {{ busy ? 'Wird freigeschaltet …' : `Ja, ${kosten} abbuchen` }}
        </GButton>
        <GButton variant="outline" :disabled="busy" @click="abbrechen">Abbrechen</GButton>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 0;
  border: 0;
  border-radius: var(--r-card);
  background: var(--c-white);
  color: var(--c-text);
}

.dialog::backdrop {
  background: rgba(10, 12, 20, 0.55);
}

.inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 28px;
}

/* Der Name trägt die Rückfrage — er ist das, was geprüft werden soll. */
.gegenstand {
  font-size: var(--fs-body);
  font-weight: 600;
  line-height: 1.35;
}

.zusatz {
  margin-top: -6px;
  color: var(--c-text-muted);
}

.rechnung {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding: 14px 18px;
  border-radius: var(--r-card);
  background: var(--c-surface);
}

.rechnung > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.rechnung dt {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.rechnung dd {
  font-size: var(--fs-secondary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.hinweis {
  color: var(--c-text-muted);
  line-height: 1.5;
}

.fehler {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

.knoepfe {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 6px;
}
</style>
