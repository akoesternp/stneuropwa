<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import VideoTile from '@/components/VideoTile.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useFortschrittStore } from '@/stores/fortschritt'
import { usePaketeStore } from '@/stores/pakete'
import { dauerInSekunden } from '@/utils/format'

/**
 * Der Inhalt eines Pakets als Kachel-Übersicht, wie auf der Startseite.
 *
 * Titel, Untertitel und Beschreibung stehen an jeder Kachel — auch an den
 * gesperrten: sie sagen, worum es in dem Video geht, ohne etwas preiszugeben.
 * Abspielbar sind nur die freigeschalteten; die übrigen sind keine Links, und
 * der Stream-Endpunkt gäbe sie ohnehin nicht heraus.
 */
const route = useRoute()
const auth = useAuthStore()
const pakete = usePaketeStore()
const fortschritt = useFortschrittStore()

onMounted(() => {
  void pakete.ensureLoaded()
  if (auth.isAuthenticated) void fortschritt.reload()
})

// Mit der Sitzung ändert sich, was als freigeschaltet gilt.
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

const erledigtAnzahl = computed(
  () => paket.value?.videos.filter((video) => fortschritt.fuer(video.id)?.erledigt).length ?? 0,
)

/** Anteil einer Übung am Fortschrittsbalken der Kachel. */
function anteil(videoId: number, dauer: string): number {
  const stand = fortschritt.fuer(videoId)
  if (!stand?.position) return 0
  const gesamt = dauerInSekunden(dauer)
  return gesamt ? stand.position / gesamt : 0
}
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
            ><template v-if="offeneAnzahl"> · {{ offeneAnzahl }} gesperrt</template
            ><template v-if="auth.isAuthenticated && erledigtAnzahl">
              · {{ erledigtAnzahl }} von {{ paket.videos.length }} erledigt</template
            >
          </p>
        </div>
        <span v-if="hatPaket" class="marke frei">Freigeschaltet</span>
      </header>

      <div v-if="paket.videos.length" class="grid">
        <VideoTile
          v-for="video in paket.videos"
          :id="video.id"
          :key="video.id"
          :titel="video.titel"
          :untertitel="video.untertitel"
          :beschreibung="video.beschreibung"
          :dauer="video.dauer"
          :kategorien="[video.bereich, video.schwierigkeit].filter(Boolean)"
          :gesperrt="!video.freigeschaltet"
          :ohne-datei="!video.hatDatei"
          :anteil="anteil(video.id, video.dauer)"
          :erledigt="fortschritt.fuer(video.id)?.erledigt ?? false"
        />
      </div>

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
  max-width: 70ch;
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

/* Dasselbe Raster wie auf der Startseite. */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 22px;
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
  max-width: 70ch;
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
