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
</script>

<template>
  <RouterLink class="karte" :to="{ name: 'paket', params: { id: paket.id } }">
    <div class="kopf">
      <h3 class="t-h3">{{ paket.name }}</h3>
      <span v-if="freigeschaltet" class="marke frei">Freigeschaltet</span>
      <span v-else-if="auth.isAuthenticated" class="marke zu">Nicht freigeschaltet</span>
    </div>

    <p v-if="paket.beschreibung" class="beschreibung">{{ paket.beschreibung }}</p>

    <ul class="vorschau">
      <li v-for="video in paket.videos.slice(0, 3)" :key="video.id">
        <span class="t-truncate">{{ video.titel }}</span>
        <span class="dauer t-meta">{{ video.dauer || '–' }}</span>
      </li>
    </ul>

    <p class="fuss t-meta">
      {{ paket.videos.length }} Übung{{ paket.videos.length === 1 ? '' : 'en'
      }}<template v-if="paket.gesamtdauer"> · {{ paket.gesamtdauer }} Laufzeit</template>
      <template v-if="offen"> · {{ offen }} gesperrt</template>
      <template v-if="paket.videos.length > 3"> · vollständige Liste ansehen</template>
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

.beschreibung {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--c-text-muted);
}

.vorschau {
  list-style: none;
  margin: 0;
  padding: 14px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--c-hairline-2);
}

.vorschau li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-secondary);
  min-width: 0;
}

.dauer {
  flex: none;
}

.fuss {
  margin-top: auto;
}
</style>
