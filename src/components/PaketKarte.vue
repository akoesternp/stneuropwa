<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { PaketInhalt } from '@shared/types'

/**
 * Ein Paket als Karte — in der Paketübersicht wie in einer Zielgruppe.
 *
 * Bewusst eine gemeinsame Komponente: ein Paket soll überall gleich aussehen
 * und vor allem überall gleich auskunftsfähig sein, ob es freigeschaltet ist.
 * Zwei Fassungen desselben Kärtchens liefen früher oder später auseinander.
 */
const props = defineProps<{ paket: PaketInhalt }>()

const auth = useAuthStore()

/**
 * Freigeschaltet heißt: dem Nutzer ist dieses PAKET zugewiesen.
 * Einzeln freigeschaltete Übungen daraus zählen hier bewusst nicht — sonst
 * stünde „Freigeschaltet" an einem Paket, von dem man nur ein Video hat.
 */
const freigeschaltet = computed(() => auth.user?.pakete.includes(props.paket.name) ?? false)

const offen = computed(() => props.paket.videos.filter((video) => !video.freigeschaltet).length)

/**
 * Im ganzen Paket ist noch nichts abspielbar. Das verdient ein Zeichen statt
 * nur einer Zahl im Fuß: es ist der Unterschied zwischen „hier fehlt Ihnen
 * noch etwas" und „hier kommen Sie gar nicht hinein".
 */
const komplettGesperrt = computed(
  () => props.paket.videos.length > 0 && offen.value === props.paket.videos.length,
)

/** Ab wie vielen Übungen die Vorschau abbricht. */
const VORSCHAU = 3

const hatMehr = computed(() => props.paket.videos.length > VORSCHAU)

/*
 * Bei mehr Übungen wird eine vierte Zeile mitgerendert und angeschnitten: ein
 * Verlauf über einer sauber endenden Liste sähe aus wie ein Schatten — erst
 * die halbe Zeile darunter erzählt „hier geht es weiter".
 */
const vorschauVideos = computed(() =>
  props.paket.videos.slice(0, hatMehr.value ? VORSCHAU + 1 : VORSCHAU),
)
</script>

<template>
  <RouterLink class="karte" :to="{ name: 'paket', params: { id: paket.id } }">
    <div class="kopf">
      <h3 class="t-h3">{{ paket.name }}</h3>

      <span class="marken">
        <!--
          Das Schloss gilt auch für Gäste: für sie ist die Frage „komme ich
          hier überhaupt rein" dieselbe, und ein Wort dazu wäre an jeder Karte
          nur Rauschen.
        -->
        <span
          v-if="komplettGesperrt"
          class="schloss"
          role="img"
          aria-label="Noch nichts freigeschaltet"
          title="Noch nichts freigeschaltet"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M7 10V7a5 5 0 0 1 10 0v3"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
            <rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor" />
          </svg>
        </span>

        <!--
          Statt „Nicht freigeschaltet" der Preis: dass es zu ist, sagt schon
          das Schloss — was es kostet, sagt sonst nichts auf dieser Karte.
        -->
        <span v-if="freigeschaltet" class="marke frei">Freigeschaltet</span>
        <span v-else-if="paket.kosten" class="marke preis">
          {{ paket.kosten }} {{ paket.kosten === 1 ? 'Credit' : 'Credits' }}
        </span>
        <span v-else-if="auth.isAuthenticated" class="marke zu">Nicht freigeschaltet</span>
      </span>
    </div>

    <p v-if="paket.beschreibung" class="beschreibung">{{ paket.beschreibung }}</p>

    <ul class="vorschau" :class="{ mehr: hatMehr }">
      <li v-for="video in vorschauVideos" :key="video.id">
        <span class="t-truncate">{{ video.titel }}</span>
        <span class="dauer t-meta">{{ video.dauer || '–' }}</span>
      </li>
    </ul>

    <p class="fuss t-meta">
      {{ paket.videos.length }} Übung{{ paket.videos.length === 1 ? '' : 'en'
      }}<template v-if="paket.gesamtdauer"> · {{ paket.gesamtdauer }} Laufzeit</template>
      <template v-if="offen"> · {{ offen }} gesperrt</template>
      <template v-if="hatMehr"> · vollständige Liste ansehen</template>
    </p>
  </RouterLink>
</template>

<style scoped>
.karte {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: var(--card-pad);
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
  color: var(--c-text);
}

.karte:hover {
  border-color: var(--c-action);
  color: var(--c-text);
  text-decoration: none;
}

.kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.marken {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.schloss {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--c-surface);
  color: var(--c-text-muted);
}

.marke {
  flex: none;
  padding: 3px 12px;
  border-radius: var(--r-pill);
  font-family: var(--font-num);
  font-size: var(--fs-meta);
}

.marke.frei {
  background: var(--c-tint);
  color: var(--c-action);
}

/*
 * Zurückhaltend statt warnend: dass ein Paket nicht freigeschaltet ist, ist
 * kein Fehler des Nutzers — es ist eine Auskunft.
 */
.marke.zu {
  background: var(--c-surface);
  color: var(--c-text-muted);
}
.marke.preis {
  background: var(--c-dark);
  color: var(--c-on-dark);
  font-variant-numeric: tabular-nums;
}

.beschreibung {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--c-text-muted);
}

.vorschau {
  --zeile: 21px;
  --abstand: 8px;
  --kopfrand: 14px;

  list-style: none;
  margin: 0;
  padding: var(--kopfrand) 0 0;
  display: flex;
  flex-direction: column;
  gap: var(--abstand);
  border-top: 1px solid var(--c-hairline-2);
}

.vorschau li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-secondary);
  /* Feste Zeilenhöhe: die Höhe unten wird gerechnet, nicht geraten. */
  line-height: 1.5;
  min-width: 0;
}

/*
 * Drei volle Zeilen, von der vierten nur ein Streifen. Das trägt, weil jede
 * Zeile durch t-truncate einzeilig bleibt — bei umbrechendem Text wäre eine
 * gerechnete Höhe falsch.
 */
.vorschau.mehr {
  position: relative;
  /*
   * `--blick` ist der stehengelassene Streifen der vierten Zeile. Bei 21 px
   * Zeilenhöhe sitzen die Buchstaben etwa zwischen 3 und 17 px — 15 px lassen
   * also die obere Hälfte des Titels sehen, was den Bruch erst erzählt.
   */
  --blick: 15px;

  max-height: calc(var(--kopfrand) + 3 * var(--zeile) + 3 * var(--abstand) + var(--blick));
  overflow: hidden;
}

.vorschau.mehr::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  /*
   * Kürzer als der Streifen hoch ist, damit dessen obere Kante frei bleibt.
   * Ein langer Verlauf deckte den vierten Titel vollständig zu — dann sähe man
   * nur noch einen Schleier und nicht, dass dort Text steht.
   */
  height: 20px;
  /*
   * Von durchsichtigem Weiß nach Weiß statt von `transparent`: die Kartenfläche
   * ist weiß, und so bleibt der Verlauf frei von einem Graustich.
   */
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0), var(--c-white));
  pointer-events: none;
}

.dauer {
  flex: none;
}

.fuss {
  margin-top: auto;
}
</style>
