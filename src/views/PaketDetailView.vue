<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { useAuthStore } from '@/stores/auth'
import { usePaketeStore } from '@/stores/pakete'

/**
 * Das Inhaltsverzeichnis eines Pakets: alle Titel mit Laufzeit, auch ohne
 * Anmeldung. Abspielbar sind nur die Einträge mit `freigeschaltet` — die
 * übrigen bleiben Text, der Stream-Endpunkt gäbe sie ohnehin nicht heraus.
 */
const route = useRoute()
const auth = useAuthStore()
const pakete = usePaketeStore()

onMounted(() => {
  void pakete.ensureLoaded()
})

watch(
  () => auth.isAuthenticated,
  () => void pakete.reload(),
)

const paket = computed(() =>
  pakete.pakete.find((eintrag) => eintrag.id === Number(route.params.id)),
)

/** Hat der Nutzer das ganze Paket? Einzelfreischaltungen zählen hier nicht. */
const hatPaket = computed(() => auth.user?.pakete.includes(paket.value?.name ?? '') ?? false)
const offeneAnzahl = computed(
  () => paket.value?.videos.filter((video) => !video.freigeschaltet).length ?? 0,
)
</script>

<template>
  <section class="detail">
    <p v-if="pakete.error" class="state error" role="alert">{{ pakete.error }}</p>
    <p v-else-if="!pakete.loaded" class="state">Paket wird geladen …</p>

    <template v-else-if="paket">
      <header class="head">
        <div class="titles">
          <RouterLink :to="{ name: 'pakete' }" class="zurueck t-meta">← Alle Pakete</RouterLink>
          <h1 class="t-h2">{{ paket.name }}</h1>
          <p v-if="paket.beschreibung" class="t-subhead">{{ paket.beschreibung }}</p>
          <p class="umfang t-meta">
            {{ paket.videos.length }} Video{{ paket.videos.length === 1 ? '' : 's' }}<template
              v-if="paket.gesamtdauer"
            >
              · {{ paket.gesamtdauer }} Gesamtlaufzeit</template
            >
          </p>
        </div>
        <span v-if="hatPaket" class="marke frei">Freigeschaltet</span>
      </header>

      <ol v-if="paket.videos.length" class="liste">
        <li v-for="(video, index) in paket.videos" :key="video.id" class="zeile">
          <span class="nummer t-meta">{{ String(index + 1).padStart(2, '0') }}</span>

          <RouterLink
            v-if="video.freigeschaltet"
            :to="{ name: 'video', params: { id: video.id } }"
            class="titel-link"
          >
            <span class="titel">{{ video.titel }}</span>
            <span v-if="video.untertitel" class="untertitel">{{ video.untertitel }}</span>
          </RouterLink>

          <span v-else class="titel-link gesperrt">
            <span class="titel">{{ video.titel }}</span>
            <span v-if="video.untertitel" class="untertitel">{{ video.untertitel }}</span>
          </span>

          <span v-if="!video.freigeschaltet" class="schloss t-meta" title="Nicht freigeschaltet"
            >gesperrt</span
          >
          <span class="dauer t-meta">{{ video.dauer || '–' }}</span>
        </li>
      </ol>

      <p v-else class="state">In diesem Paket sind noch keine Videos enthalten.</p>

      <GCard v-if="offeneAnzahl" variant="gradient" class="cta">
        <h2 class="t-h3">
          {{ auth.isAuthenticated ? 'Noch nicht freigeschaltet' : 'Zugang erforderlich' }}
        </h2>
        <p class="cta-text">
          {{
            auth.isAuthenticated
              ? `${offeneAnzahl} Video${offeneAnzahl === 1 ? '' : 's'} aus diesem Paket ${offeneAnzahl === 1 ? 'ist' : 'sind'} Ihrem Zugang nicht zugewiesen. Wenden Sie sich an uns, um das Paket freizuschalten.`
              : 'Melden Sie sich an, um die Videos dieses Pakets anzusehen — sofern es Ihrem Zugang zugewiesen ist.'
          }}
        </p>
        <GButton v-if="!auth.isAuthenticated" variant="white" :to="{ name: 'login' }">
          Anmelden
        </GButton>
      </GCard>
    </template>

    <div v-else class="missing">
      <p class="t-h3">Dieses Paket gibt es nicht.</p>
      <GButton variant="outline" :to="{ name: 'pakete' }">Zur Paketübersicht</GButton>
    </div>
  </section>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
  max-width: 900px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.titles {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.zurueck {
  color: var(--c-text-muted);
}

.umfang {
  margin-top: 4px;
}

.marke {
  flex: none;
  padding: 5px 14px;
  border-radius: var(--r-pill);
  font-family: var(--font-num);
  font-size: var(--fs-meta);
}

.marke.frei {
  background: var(--c-tint);
  color: var(--c-action);
}

.state {
  font-size: var(--fs-body);
  color: var(--c-subhead);
}

.state.error {
  color: var(--c-red);
}

.liste {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
  overflow: hidden;
}

.zeile {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--c-hairline-3);
}

.zeile:last-child {
  border-bottom: 0;
}

.nummer {
  flex: none;
  width: 24px;
}

.titel-link {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--c-text);
}

.titel-link:hover {
  color: var(--c-action);
  text-decoration: none;
}

/* Gesperrte Titel bleiben lesbar, sind aber sichtbar kein Link. */
.gesperrt {
  color: var(--c-text-muted);
  cursor: default;
}

.titel {
  font-size: var(--fs-body);
  font-weight: 500;
}

.untertitel {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.schloss,
.dauer {
  flex: none;
}

.schloss {
  padding: 2px 10px;
  border-radius: var(--r-pill);
  background: var(--c-surface);
}

.cta {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
}

.cta-text {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--c-on-dark);
}

.missing {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: flex-start;
  padding: 40px;
  border-radius: var(--r-card);
  background: var(--c-surface);
}
</style>
