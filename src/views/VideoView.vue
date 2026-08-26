<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import GButton from '@/components/ui/GButton.vue'
import { useAuthStore } from '@/stores/auth'
import { useVideosStore } from '@/stores/videos'

/**
 * Die Abspielseite. Das <video>-Element zieht den Stream direkt von der API;
 * das Sitzungscookie geht automatisch mit (gleiche Origin) — Tokens oder
 * signierte Links braucht es deshalb nicht.
 *
 * Die Metadaten kommen aus der Kachel-Liste des Stores. Steht das Video dort
 * nicht drin, darf dieser Aufrufer es nicht sehen (oder es gibt es nicht) —
 * beides bekommt dieselbe Ansicht, denn der Unterschied geht ihn nichts an.
 */
const route = useRoute()
const auth = useAuthStore()
const videos = useVideosStore()

onMounted(() => {
  void videos.ensureLoaded()
})

const video = computed(() =>
  videos.videos.find((eintrag) => eintrag.id === Number(route.params.id)),
)

const streamUrl = computed(() => `/api/portal/videos/${Number(route.params.id)}/stream`)
</script>

<template>
  <section class="player">
    <p v-if="!videos.loaded" class="state">Inhalte werden geladen …</p>

    <template v-else-if="video">
      <header class="head">
        <div class="titles">
          <h1 class="t-h2">{{ video.titel }}</h1>
          <p v-if="video.untertitel" class="t-subhead">{{ video.untertitel }}</p>
        </div>
        <GButton variant="outline" size="sm" :to="{ name: 'home' }">Zur Übersicht</GButton>
      </header>

      <!-- controlsList/disablePictureInPicture sind Höflichkeit, kein Schutz —
           der eigentliche Schutz ist die Berechtigungsprüfung im Stream. -->
      <video
        v-if="video.datei"
        class="video"
        :src="streamUrl"
        controls
        preload="metadata"
        controlslist="nodownload"
      />

      <div v-else class="soon">
        <p class="t-h3">Demnächst verfügbar</p>
        <p class="soon-text">
          Zu dieser Kachel ist noch keine Videodatei hinterlegt.
        </p>
      </div>

      <p class="meta t-meta">
        {{ video.paketNamen.length ? video.paketNamen.join(' · ') : 'Frei verfügbar'
        }}<template v-if="video.dauer"> · {{ video.dauer }}</template>
      </p>
    </template>

    <div v-else class="missing">
      <p class="t-h3">Dieses Video ist hier nicht verfügbar.</p>
      <p class="soon-text">
        {{
          auth.isAuthenticated
            ? 'Es gehört zu keinem Ihrer Pakete — oder es existiert nicht.'
            : 'Möglicherweise wird es nach der Anmeldung sichtbar.'
        }}
      </p>
      <div class="missing-actions">
        <GButton v-if="!auth.isAuthenticated" :to="{ name: 'login' }">Anmelden</GButton>
        <GButton variant="outline" :to="{ name: 'home' }">Zur Übersicht</GButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
  max-width: 1100px;
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

.video {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-card);
  background: var(--c-dark);
  display: block;
}

.soon,
.missing {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  padding: 40px;
  border-radius: var(--r-card);
  background: var(--c-surface);
}

.soon-text {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
  line-height: 1.6;
}

.missing-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.meta {
  color: var(--c-text-muted);
}
</style>
