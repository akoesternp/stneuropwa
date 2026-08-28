<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import FilterLeiste from '@/components/FilterLeiste.vue'
import VideoTile from '@/components/VideoTile.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useFortschrittStore } from '@/stores/fortschritt'
import { useVideosStore } from '@/stores/videos'
import { dauerInSekunden } from '@/utils/format'
import type { KatalogVideo, Zugangsfilter } from '@/types'

/**
 * Alle Übungen am Stück — für die Suche nach einer einzelnen.
 *
 * Die Startseite gliedert nach Zielgruppen und Paketen; das hilft beim
 * Stöbern, steht aber im Weg, wenn man eine bestimmte Übung sucht. Hier gibt
 * es deshalb nur die flache Liste, dafür mit derselben Filterleiste.
 *
 * Und zwar der GANZE Bestand, nicht nur das Freigeschaltete: wer eine
 * bestimmte Übung sucht, soll sie finden — auch ohne einen einzigen Zugang.
 * Die gesperrten Kacheln tragen ein Schloss und führen auf die Detailseite,
 * die zeigt, über welches Paket die Übung zugänglich wird.
 */
const auth = useAuthStore()
const videos = useVideosStore()
const fortschritt = useFortschrittStore()

const suche = ref('')
const bereichFilter = ref<string[]>([])
const schwierigkeitFilter = ref<string[]>([])
const zugangFilter = ref<Zugangsfilter>('')

onMounted(() => {
  void videos.ensureLoaded()
  if (auth.isAuthenticated) void fortschritt.reload()
})

watch(
  () => auth.isAuthenticated,
  (angemeldet) => {
    void videos.reload()
    if (angemeldet) void fortschritt.reload()
  },
)

const treffer = computed(() => {
  const begriff = suche.value.trim().toLowerCase()

  return videos.videos.filter((video) => {
    if (zugangFilter.value === 'frei' && !video.freigeschaltet) return false
    if (zugangFilter.value === 'gesperrt' && video.freigeschaltet) return false
    if (bereichFilter.value.length && !bereichFilter.value.includes(video.bereich)) return false
    if (
      schwierigkeitFilter.value.length &&
      !schwierigkeitFilter.value.includes(video.schwierigkeit)
    ) {
      return false
    }
    if (!begriff) return true

    // Hilfsmittel bewusst durchsuchbar: „ohne Ball" ist eine echte Frage.
    return [video.titel, video.untertitel, video.beschreibung, video.hilfsmittel]
      .join(' ')
      .toLowerCase()
      .includes(begriff)
  })
})

/** Wie viele der Treffer noch gesperrt sind — beziffert den Hinweis unten. */
const offeneTreffer = computed(
  () => treffer.value.filter((video) => !video.freigeschaltet).length,
)

function anteil(video: KatalogVideo): number {
  const stand = fortschritt.fuer(video.id)
  if (!stand?.position) return 0
  const gesamt = dauerInSekunden(video.dauer)
  return gesamt ? stand.position / gesamt : 0
}

function erledigt(video: KatalogVideo): boolean {
  return fortschritt.fuer(video.id)?.erledigt ?? false
}
</script>

<template>
  <section class="liste">
    <header class="head">
      <div class="titles">
        <h1 class="t-h2">Alle Übungen</h1>
        <p class="t-subhead">
          Der gesamte Übungsbestand, flach durchsuchbar — auch was noch nicht
          freigeschaltet ist.
        </p>
      </div>
    </header>

    <FilterLeiste
      v-model:suche="suche"
      v-model:bereiche="bereichFilter"
      v-model:grade="schwierigkeitFilter"
      v-model:zugang="zugangFilter"
      :verfuegbare-bereiche="videos.bereiche"
      mit-zugang
    />

    <p v-if="videos.error" class="state error" role="alert">{{ videos.error }}</p>
    <p v-else-if="!videos.loaded" class="state">Inhalte werden geladen …</p>

    <template v-else>
      <p class="state">
        {{ treffer.length }} von {{ videos.videos.length }}
        <!--
          Bei gesetztem Zugangsfilter sagt der Zusatz nichts mehr: dann sind
          entweder alle Treffer offen oder alle gesperrt, und das steht schon
          am angeschalteten Knopf.
        -->
        {{ videos.videos.length === 1 ? 'Übung' : 'Übungen'
        }}<template v-if="offeneTreffer && !zugangFilter">
          · {{ offeneTreffer }} noch nicht freigeschaltet</template
        >
      </p>

      <div v-if="treffer.length" class="grid">
        <VideoTile
          v-for="video in treffer"
          :id="video.id"
          :key="video.id"
          :titel="video.titel"
          :untertitel="video.untertitel"
          :beschreibung="video.beschreibung"
          :dauer="video.dauer"
          :kategorien="[video.bereich, video.schwierigkeit].filter(Boolean)"
          :hilfsmittel="video.hilfsmittel"
          :marken="[
            ...(video.oeffentlich ? ['Frei verfügbar'] : []),
            ...video.paketNamen,
          ]"
          :gesperrt="!video.freigeschaltet"
          :ohne-datei="!video.hatDatei"
          :anteil="anteil(video)"
          :erledigt="erledigt(video)"
        />
      </div>

      <!--
        „Freigeschaltet" ohne Treffer ist kein Suchfehler, sondern der Normalfall
        für ein frisches Konto — ein Rat zum Suchbegriff ginge daran vorbei.
      -->
      <p v-else-if="zugangFilter === 'frei'" class="state">
        Für Sie ist noch nichts freigeschaltet. Ohne diesen Filter sehen Sie den ganzen Bestand.
      </p>

      <p v-else-if="zugangFilter === 'gesperrt'" class="state">
        Hier ist nichts gesperrt — Sie haben zu dieser Auswahl bereits alles.
      </p>

      <p v-else class="state">
        Nichts gefunden. Ein anderes Merkmal oder ein kürzerer Suchbegriff hilft meist.
      </p>

      <!--
        Die Liste zeigt Gästen auch Gesperrtes — gerade dann ist der Hinweis
        fällig, wie sich daraus Abspielbares macht.
      -->
      <GCard v-if="!auth.isAuthenticated" variant="gradient" class="cta">
        <h2 class="t-h3">Mehr Übungen freischalten</h2>
        <p class="cta-text">
          Gefunden haben Sie hier alles. Abspielen lässt sich ohne Konto nur, was frei zugänglich
          ist — mit einem Konto merkt sich das Portal Ihren Fortschritt, freigeschaltete Pakete
          öffnen den Rest.
        </p>
        <div class="cta-knoepfe">
          <GButton variant="white" :to="{ name: 'registrieren' }">Konto anlegen</GButton>
          <GButton variant="white" :to="{ name: 'login' }">Anmelden</GButton>
        </div>
      </GCard>
    </template>
  </section>
</template>

<style scoped>
.liste {
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
  align-items: flex-start;
}

.cta-text {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--c-on-dark);
  max-width: 60ch;
}

.cta-knoepfe {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
