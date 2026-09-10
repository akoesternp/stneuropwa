<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import SterneWertung from '@/components/SterneWertung.vue'
import GButton from '@/components/ui/GButton.vue'
import { api, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { KOMMENTAR_MAX_ZEICHEN } from '@shared/types'
import type { Kommentar, KommentarBereich } from '@/types'

/**
 * Sterne und Beiträge unter einer Übung.
 *
 * Zwei getrennte Dinge: eine Wertung je Nutzer und Übung, und davon unabhängig
 * ein Gespräch. Beides setzt voraus, dass die Übung für den Schreibenden
 * freigeschaltet ist — geprüft wird das im Server, hier steht nur, was die
 * Oberfläche daraufhin anbietet.
 */
const props = defineProps<{
  videoId: number
  /** Darf dieser Aufrufer die Übung abspielen? Nur dann darf er schreiben. */
  freigeschaltet: boolean
}>()

const auth = useAuthStore()

const bereich = ref<KommentarBereich | null>(null)
const laedt = ref(true)
const fehler = ref<string | null>(null)
const hinweis = ref<string | null>(null)

const text = ref('')
const antwortAuf = ref<number | null>(null)
const antwortText = ref('')
const busy = ref(false)

/**
 * Moderationsrecht am eigenen Portalkonto — nicht die Backend-Sitzung.
 *
 * Die beiden Rollen sind getrennt: wer hier moderiert, ist als Nutzer
 * angemeldet und braucht keinen zweiten Zugang.
 */
const moderiert = computed(() => auth.user?.moderator === true)

/** Schreiben darf, wer die Übung hat — ein Moderator überall. */
const darfSchreiben = computed(
  () => auth.isAuthenticated && (props.freigeschaltet || moderiert.value),
)

/** Beiträge in der Wurzel; Antworten hängen darunter. */
const beitraege = computed(() =>
  (bereich.value?.kommentare ?? []).filter((eintrag) => eintrag.elternId === null),
)

function antwortenAuf(elternId: number): Kommentar[] {
  return (bereich.value?.kommentare ?? []).filter((eintrag) => eintrag.elternId === elternId)
}

const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

async function laden(): Promise<void> {
  laedt.value = true
  try {
    bereich.value = await api.get<KommentarBereich>(`/portal/videos/${props.videoId}/kommentare`)
    fehler.value = null
  } catch {
    bereich.value = null
    fehler.value = 'Die Beiträge konnten nicht geladen werden.'
  } finally {
    laedt.value = false
  }
}

onMounted(laden)

// Beim Wechsel auf eine andere Übung gehören die alten Beiträge nicht stehen.
watch(
  () => props.videoId,
  () => {
    text.value = ''
    antwortAuf.value = null
    hinweis.value = null
    void laden()
  },
)

async function werten(wert: number): Promise<void> {
  fehler.value = null
  try {
    // Die Antwort enthält den neuen Stand — kein zweiter Abruf nötig.
    bereich.value = await api.put<KommentarBereich>(`/portal/videos/${props.videoId}/sterne`, {
      sterne: wert,
    })
  } catch (cause) {
    fehler.value = cause instanceof ApiError ? cause.message : 'Die Wertung ging nicht durch.'
  }
}

async function wertungZuruecknehmen(): Promise<void> {
  try {
    bereich.value = await api.delete<KommentarBereich>(`/portal/videos/${props.videoId}/sterne`)
  } catch {
    fehler.value = 'Die Wertung ließ sich nicht entfernen.'
  }
}

/**
 * Schreiben — immer über das Portal, nie über das Backend.
 *
 * Ob der Beitrag als Betreiber gilt und sofort erscheint, entscheidet der
 * Server am Moderationsrecht des Kontos. Die Oberfläche schickt für alle
 * dasselbe.
 */
async function senden(inhalt: string, elternId: number | null): Promise<void> {
  if (!inhalt.trim()) return

  busy.value = true
  fehler.value = null
  hinweis.value = null
  try {
    const ergebnis = await api.post<{ id: number; sichtbar?: boolean }>(
      `/portal/videos/${props.videoId}/kommentare`,
      { text: inhalt.trim(), elternId },
    )

    if (ergebnis.sichtbar === false) {
      hinweis.value =
        'Danke! Ihr erster Beitrag wird noch geprüft und erscheint anschließend öffentlich.'
    }

    text.value = ''
    antwortText.value = ''
    antwortAuf.value = null
    await laden()
  } catch (cause) {
    fehler.value = cause instanceof ApiError ? cause.message : 'Der Beitrag ging nicht durch.'
  } finally {
    busy.value = false
  }
}

/** Freigeben oder ablehnen — direkt unter der Übung, wo der Beitrag steht. */
async function pruefen(id: number, was: 'freigeben' | 'ablehnen'): Promise<void> {
  busy.value = true
  fehler.value = null
  try {
    await api.post(`/portal/kommentare/${id}/${was}`)
    hinweis.value =
      was === 'freigeben'
        ? 'Freigegeben — weitere Beiträge dieses Kontos erscheinen jetzt sofort.'
        : 'Abgelehnt. Der Beitrag bleibt Ihnen sichtbar, öffentlich ist er nicht.'
    await laden()
  } catch (cause) {
    fehler.value = cause instanceof ApiError ? cause.message : 'Das ging nicht durch.'
  } finally {
    busy.value = false
  }
}

async function loeschen(id: number): Promise<void> {
  if (!confirm('Diesen Beitrag löschen? Antworten darauf verschwinden mit.')) return

  try {
    await api.delete(`/portal/kommentare/${id}`)
    await laden()
  } catch {
    fehler.value = 'Der Beitrag ließ sich nicht löschen.'
  }
}
</script>

<template>
  <section class="kommentare">
    <header class="kopf">
      <h2 class="t-h3">Bewertungen und Beiträge</h2>
      <SterneWertung
        v-if="bereich"
        :wert="bereich.schnitt"
        :anzahl="bereich.sterneAnzahl"
      />
    </header>

    <p v-if="laedt" class="state">Beiträge werden geladen …</p>
    <p v-else-if="fehler" class="state error" role="alert">{{ fehler }}</p>

    <template v-else-if="bereich">
      <!-- ── Eigene Wertung ─────────────────────────────────────────── -->
      <div v-if="darfSchreiben" class="eigene-wertung">
        <span class="t-eyebrow">Ihre Wertung</span>
        <div class="wertung-zeile">
          <SterneWertung :wert="bereich.meineSterne" setzbar @setzen="werten" />
          <GButton
            v-if="bereich.meineSterne"
            variant="text"
            size="sm"
            @click="wertungZuruecknehmen"
          >
            Zurücknehmen
          </GButton>
        </div>
      </div>

      <p v-else-if="auth.isAuthenticated" class="state">
        Bewerten und schreiben können Sie, sobald diese Übung für Sie freigeschaltet ist.
      </p>

      <!-- ── Neuer Beitrag ──────────────────────────────────────────── -->
      <form v-if="darfSchreiben" class="formular" @submit.prevent="senden(text, null)">
        <textarea
          v-model="text"
          class="feld"
          rows="3"
          :maxlength="KOMMENTAR_MAX_ZEICHEN"
          :placeholder="
            moderiert ? 'Als Betreiber schreiben …' : 'Wie ist Ihnen die Übung bekommen?'
          "
        />
        <div class="formular-fuss">
          <span class="rest t-meta">{{ KOMMENTAR_MAX_ZEICHEN - text.length }} Zeichen frei</span>
          <GButton type="submit" size="sm" :disabled="busy || !text.trim()">
            {{ moderiert ? 'Als Betreiber senden' : 'Beitrag senden' }}
          </GButton>
        </div>
      </form>

      <p v-if="hinweis" class="hinweis" role="status">{{ hinweis }}</p>

      <!-- ── Die Beiträge ───────────────────────────────────────────── -->
      <ol v-if="beitraege.length" class="liste">
        <li v-for="beitrag in beitraege" :key="beitrag.id" class="beitrag">
          <article class="karte" :class="{ team: beitrag.vomTeam, offen: beitrag.status === 'offen' }">
            <header class="beitrag-kopf">
              <span class="wer">{{ beitrag.vomTeam ? 'Das stneuro-Team' : beitrag.name }}</span>
              <span class="wann t-meta">{{ datum.format(beitrag.angelegtAm) }}</span>
              <span v-if="beitrag.status === 'offen'" class="marke t-meta">wird geprüft</span>
            </header>
            <p class="text">{{ beitrag.text }}</p>
            <div class="beitrag-aktionen">
              <button
                v-if="darfSchreiben"
                type="button"
                class="klein"
                @click="antwortAuf = antwortAuf === beitrag.id ? null : beitrag.id"
              >
                {{ antwortAuf === beitrag.id ? 'Abbrechen' : 'Antworten' }}
              </button>

              <!--
                Geprüft wird dort, wo der Beitrag steht — mit dem Zusammenhang
                vor Augen statt in einer Liste ohne ihn.
              -->
              <template v-if="moderiert && beitrag.status !== 'freigegeben'">
                <button type="button" class="klein" :disabled="busy" @click="pruefen(beitrag.id, 'freigeben')">
                  Freigeben
                </button>
                <button
                  v-if="beitrag.status === 'offen'"
                  type="button"
                  class="klein still"
                  :disabled="busy"
                  @click="pruefen(beitrag.id, 'ablehnen')"
                >
                  Ablehnen
                </button>
              </template>

              <button
                v-if="moderiert || (!beitrag.vomTeam && beitrag.status === 'offen')"
                type="button"
                class="klein still"
                @click="loeschen(beitrag.id)"
              >
                Löschen
              </button>
            </div>
          </article>

          <!-- Antworten, eine Ebene tief — tiefer hängt der Server um. -->
          <ol v-if="antwortenAuf(beitrag.id).length" class="antworten">
            <li v-for="antwort in antwortenAuf(beitrag.id)" :key="antwort.id">
              <article
                class="karte"
                :class="{ team: antwort.vomTeam, offen: antwort.status === 'offen' }"
              >
                <header class="beitrag-kopf">
                  <span class="wer">
                    {{ antwort.vomTeam ? 'Das stneuro-Team' : antwort.name }}
                  </span>
                  <span class="wann t-meta">{{ datum.format(antwort.angelegtAm) }}</span>
                  <span v-if="antwort.status === 'offen'" class="marke t-meta">wird geprüft</span>
                </header>
                <p class="text">{{ antwort.text }}</p>
                <div v-if="moderiert" class="beitrag-aktionen">
                  <button
                    v-if="antwort.status !== 'freigegeben'"
                    type="button"
                    class="klein"
                    :disabled="busy"
                    @click="pruefen(antwort.id, 'freigeben')"
                  >
                    Freigeben
                  </button>
                  <button type="button" class="klein still" @click="loeschen(antwort.id)">
                    Löschen
                  </button>
                </div>
              </article>
            </li>
          </ol>

          <form
            v-if="antwortAuf === beitrag.id"
            class="formular antwort-formular"
            @submit.prevent="senden(antwortText, beitrag.id)"
          >
            <textarea
              v-model="antwortText"
              class="feld"
              rows="2"
              :maxlength="KOMMENTAR_MAX_ZEICHEN"
              :placeholder="moderiert ? 'Als Betreiber antworten …' : 'Ihre Antwort …'"
            />
            <div class="formular-fuss">
              <GButton type="submit" size="sm" :disabled="busy || !antwortText.trim()">
                Antwort senden
              </GButton>
            </div>
          </form>
        </li>
      </ol>

      <p v-else class="state">
        Noch keine Beiträge.<template v-if="darfSchreiben"> Schreiben Sie den ersten.</template>
      </p>
    </template>
  </section>
</template>

<style scoped>
.kommentare {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: var(--section-gap);
  border-top: 1px solid var(--c-hairline);
}

.kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.state {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.state.error {
  color: var(--c-red);
}

.hinweis {
  font-size: var(--fs-secondary);
  color: var(--c-action);
}

/* ── Eigene Wertung ───────────────────────────────────────────────── */
.eigene-wertung {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 20px;
  border-radius: var(--r-card);
  background: var(--c-surface);
  align-self: flex-start;
}

.wertung-zeile {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* ── Formular ─────────────────────────────────────────────────────── */
.formular {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 70ch;
}

.feld {
  width: 100%;
  padding: 14px 18px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-white);
  font-family: inherit;
  font-size: var(--fs-secondary);
  line-height: 1.6;
  resize: vertical;
}

.feld:focus-visible {
  outline: 2px solid var(--c-focus);
  outline-offset: 1px;
}

.formular-fuss {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.rest {
  color: var(--c-text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Beiträge ─────────────────────────────────────────────────────── */
.liste,
.antworten {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.beitrag {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Antworten eingerückt und mit Leitlinie — die Zugehörigkeit soll man sehen,
   ohne sie zu lesen. */
.antworten {
  margin-left: 26px;
  padding-left: 18px;
  border-left: 2px solid var(--c-hairline-2);
}

.karte {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 20px;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
  max-width: 78ch;
}

/* Beiträge des Betreibers heben sich ab — sie sind Auskunft, nicht Meinung. */
.karte.team {
  background: var(--c-tint);
  border-color: transparent;
}

.karte.offen {
  border-style: dashed;
  background: var(--c-surface);
}

.beitrag-kopf {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.wer {
  font-size: var(--fs-secondary);
  font-weight: 600;
}

.karte.team .wer {
  color: var(--c-action);
}

.wann {
  color: var(--c-text-muted);
}

.marke {
  padding: 2px 10px;
  border-radius: var(--r-pill);
  background: var(--c-white);
  color: var(--c-text-muted);
}

.text {
  font-size: var(--fs-secondary);
  line-height: 1.65;
  white-space: pre-wrap;
}

.beitrag-aktionen {
  display: flex;
  gap: 14px;
}

.klein {
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: var(--fs-meta);
  font-weight: 500;
  color: var(--c-action);
  cursor: pointer;
}

.klein:hover {
  text-decoration: underline;
}

.klein:disabled {
  opacity: 0.5;
  cursor: default;
  text-decoration: none;
}

.klein.still {
  color: var(--c-text-muted);
}

.antwort-formular {
  margin-left: 26px;
}
</style>
