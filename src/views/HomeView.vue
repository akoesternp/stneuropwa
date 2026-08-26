<script setup lang="ts">
import { onMounted, watch } from 'vue'
import VideoTile from '@/components/VideoTile.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useVideosStore } from '@/stores/videos'

const auth = useAuthStore()
const videos = useVideosStore()

onMounted(() => {
  void videos.ensureLoaded()
})

/*
 * Nach An- oder Abmeldung ändert sich, was der Server herausgibt — die Liste
 * folgt also der Sitzung, nicht einem eigenen Zustand.
 */
watch(
  () => auth.isAuthenticated,
  () => void videos.reload(),
)
</script>

<template>
  <section class="home">
    <header class="head">
      <div class="titles">
        <h1 class="t-h2">Videos</h1>
        <p class="t-subhead">
          {{
            auth.isAuthenticated
              ? 'Ihre freigeschalteten Inhalte und alle frei verfügbaren Videos.'
              : 'Frei verfügbare Videos — mehr Inhalte nach der Anmeldung.'
          }}
        </p>
      </div>
    </header>

    <p v-if="videos.error" class="state error" role="alert">{{ videos.error }}</p>
    <p v-else-if="!videos.loaded" class="state">Inhalte werden geladen …</p>

    <template v-else>
      <div class="grid">
        <VideoTile v-for="video in videos.videos" :key="video.id" :video="video" />

        <!--
          Für Besucher steht am Ende des Rasters der Grund, sich anzumelden —
          als Kachel im selben Raster, nicht als Banner darüber, damit sie den
          Inhalten nicht im Weg steht.
        -->
        <GCard v-if="!auth.isAuthenticated" variant="gradient" class="cta">
          <h3 class="t-h3">Mehr sehen?</h3>
          <p class="cta-text">
            Mit Ihrem Zugang schalten Sie die Videos Ihrer gebuchten Pakete frei.
          </p>
          <GButton variant="white" :to="{ name: 'login' }">Anmelden</GButton>
        </GCard>
      </div>

      <p v-if="!videos.videos.length && auth.isAuthenticated" class="state">
        Ihnen sind noch keine Pakete zugewiesen — dadurch gibt es hier noch nichts zu sehen.
      </p>
    </template>
  </section>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
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

.state {
  font-size: var(--fs-body);
  color: var(--c-subhead);
}

.state.error {
  color: var(--c-red);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 22px;
}

.cta {
  display: flex;
  flex-direction: column;
  gap: 14px;
  justify-content: center;
  align-items: flex-start;
}

.cta-text {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--c-on-dark);
}
</style>
