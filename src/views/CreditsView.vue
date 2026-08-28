<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { api, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import {
  CREDITS_JE_VIDEO,
  CREDIT_BASISPREIS_CENT,
  CREDIT_PAKETE,
  PAKET_RABATT,
  paketPreis,
  preisJeCreditCent,
  rabattProzent,
} from '@shared/types'
import type { CreditPaket } from '@shared/types'

/**
 * Credits kaufen — und vorher erklären, was sie überhaupt wert sind.
 *
 * Eine Währung ohne Umrechnungskurs ist eine Zumutung: wer nicht weiß, was
 * eine Übung kostet, kann keine Stufe auswählen. Deshalb steht die Preisliste
 * über der Staffel, nicht darunter.
 */
const auth = useAuthStore()

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const preis = (cent: number) => euro.format(cent / 100)

const guthaben = computed(() => auth.user?.credits ?? 0)

/** Beispielrechnung für die Preisliste — ein Paket mittlerer Größe. */
const BEISPIEL_UEBUNGEN = 8

const gewaehlt = ref<CreditPaket | null>(null)
const busy = ref(false)
const fehler = ref<string | null>(null)
const erfolg = ref<string | null>(null)

/**
 * Ob der Kauf tatsächlich etwas gutschreibt, entscheidet der Server
 * (CREDITS_TESTKAUF). Wir fragen einmal nach, damit die Seite nicht zum Klick
 * auffordert, der nur in einer Fehlermeldung endet.
 */
const kaufMoeglich = ref(false)

onMounted(async () => {
  // Der Endpunkt verlangt eine Anmeldung; für Gäste wäre die Frage ein 401
  // und damit ein unnötiger Sprung auf die Anmeldeseite.
  if (!auth.isAuthenticated) return
  try {
    kaufMoeglich.value = (
      await api.get<{ moeglich: boolean }>('/portal/credits/moeglich')
    ).moeglich
  } catch {
    kaufMoeglich.value = false
  }
})

/**
 * Das größte Paket, das sich mit diesem Guthaben noch bezahlen ließe.
 *
 * Ausgerechnet statt geteilt: durch das Runden in `paketPreis` liegt die
 * Grenze nicht genau bei credits/RABATT, und eine zu große Zahl wäre ein
 * Versprechen, das die Kasse nicht hält.
 */
function reichtFuerPaket(credits: number): number {
  let anzahl = Math.ceil(credits / PAKET_RABATT) + 2
  while (anzahl > 0 && paketPreis(anzahl) > credits) anzahl--
  return anzahl
}

async function kaufen(stufe: CreditPaket): Promise<void> {
  gewaehlt.value = stufe
  busy.value = true
  fehler.value = null
  erfolg.value = null

  try {
    const ergebnis = await api.post<{ gutgeschrieben: number; credits: number }>(
      '/portal/credits/kaufen',
      { paket: stufe.id },
    )
    // Der Stand kommt aus /auth/me — eine Quelle, nicht zwei.
    await auth.restore()
    erfolg.value =
      `${ergebnis.gutgeschrieben} Credits gutgeschrieben. ` +
      `Ihr Guthaben: ${ergebnis.credits}.`
  } catch (cause) {
    fehler.value =
      cause instanceof ApiError
        ? cause.message
        : 'Der Kauf ist fehlgeschlagen. Bitte später erneut versuchen.'
  } finally {
    busy.value = false
    gewaehlt.value = null
  }
}
</script>

<template>
  <section class="credits">
    <header class="head">
      <div class="titles">
        <h1 class="t-h2">Credits</h1>
        <p class="t-subhead">
          Mit Credits schalten Sie einzelne Übungen und ganze Pakete frei — dauerhaft, ohne
          Abo und ohne Laufzeit.
        </p>
      </div>

      <span v-if="auth.isAuthenticated" class="stand">
        <span class="stand-zahl">{{ guthaben }}</span>
        <span class="t-meta">{{ guthaben === 1 ? 'Credit' : 'Credits' }} verfügbar</span>
      </span>
    </header>

    <!-- ── Was kostet was ────────────────────────────────────────────── -->
    <section class="block">
      <h2 class="t-h3">Was kostet was</h2>

      <div class="preisliste">
        <div class="posten">
          <span class="posten-wert">{{ CREDITS_JE_VIDEO }}</span>
          <span class="posten-name">
            {{ CREDITS_JE_VIDEO === 1 ? 'Credit' : 'Credits' }} je einzelne Übung
          </span>
          <p class="posten-text">
            Einmal freigeschaltet, bleibt die Übung Ihnen — samt Fortschritt und beliebig oft
            abspielbar.
          </p>
        </div>

        <div class="posten">
          <span class="posten-wert">−{{ Math.round((1 - PAKET_RABATT) * 100) }} %</span>
          <span class="posten-name">im Paket</span>
          <p class="posten-text">
            Ein Paket kostet {{ Math.round(PAKET_RABATT * 100) }} % dessen, was seine Übungen
            einzeln kosten würden. Beispiel: {{ BEISPIEL_UEBUNGEN }} Übungen einzeln
            {{ BEISPIEL_UEBUNGEN * CREDITS_JE_VIDEO }} Credits, als Paket
            {{ paketPreis(BEISPIEL_UEBUNGEN) }}.
          </p>
        </div>

        <div class="posten">
          <span class="posten-wert">{{ preis(CREDIT_BASISPREIS_CENT) }}</span>
          <span class="posten-name">je Credit einzeln</span>
          <p class="posten-text">
            Der Grundpreis. Ab dem kleinen Paket wird jeder Credit günstiger — siehe unten.
          </p>
        </div>
      </div>

      <p class="fussnote t-meta">
        Frei zugängliche Übungen bleiben frei: dafür brauchen Sie keine Credits.
      </p>
    </section>

    <!-- ── Staffel ───────────────────────────────────────────────────── -->
    <section class="block">
      <h2 class="t-h3">Credits kaufen</h2>
      <p class="einleitung">Je mehr auf einmal, desto günstiger der einzelne Credit.</p>

      <p v-if="erfolg" class="meldung ok" role="status">{{ erfolg }}</p>
      <p v-if="fehler" class="meldung fehler" role="alert">{{ fehler }}</p>

      <div class="staffel">
        <GCard v-for="stufe in CREDIT_PAKETE" :key="stufe.id" class="stufe">
          <span v-if="rabattProzent(stufe)" class="rabatt">−{{ rabattProzent(stufe) }} %</span>

          <h3 class="t-h3">{{ stufe.credits }} Credits</h3>
          <p class="stufe-name t-meta">{{ stufe.name }}</p>

          <p class="stufe-preis">{{ preis(stufe.preisCent) }}</p>
          <p class="stufe-einzel t-meta">{{ preis(preisJeCreditCent(stufe)) }} je Credit</p>

          <!--
            Der greifbare Teil: „40 Credits" sagt weniger als „reicht für etwa
            so viele Übungen".
          -->
          <p class="stufe-reicht">
            Reicht für {{ stufe.credits }} einzelne Übungen — oder ein Paket mit bis zu
            {{ reichtFuerPaket(stufe.credits) }}.
          </p>

          <GButton
            v-if="auth.isAuthenticated"
            variant="dark"
            :disabled="busy || !kaufMoeglich"
            @click="kaufen(stufe)"
          >
            {{ busy && gewaehlt?.id === stufe.id ? 'Wird gebucht …' : 'Kaufen' }}
          </GButton>
          <GButton v-else variant="dark" :to="{ name: 'login' }">Anmelden zum Kaufen</GButton>
        </GCard>
      </div>

      <!--
        Ohne angebundene Bezahlung soll die Seite trotzdem als Preisliste
        taugen — aber nicht so tun, als ließe sich hier etwas kaufen.
      -->
      <GCard v-if="auth.isAuthenticated && !kaufMoeglich" variant="gradient" class="hinweis">
        <h3 class="t-h3">Bezahlung folgt</h3>
        <p class="hinweis-text">
          Der Bezahlvorgang ist noch nicht angebunden — die Preise oben stehen fest, kaufen
          lässt sich hier aber noch nichts. Schreiben Sie uns, wenn Sie Credits brauchen; wir
          buchen sie Ihrem Konto direkt gut.
        </p>
      </GCard>
    </section>

    <GCard v-if="!auth.isAuthenticated" variant="gradient" class="hinweis">
      <h3 class="t-h3">Konto nötig</h3>
      <p class="hinweis-text">
        Credits gehören zu einem Konto — ohne Anmeldung gäbe es niemanden, dem sie gehören
        könnten. Das Anlegen ist kostenlos, und frei zugängliche Übungen können Sie auch ohne
        Guthaben ansehen.
      </p>
      <div class="hinweis-knoepfe">
        <GButton variant="white" :to="{ name: 'registrieren' }">Konto anlegen</GButton>
        <GButton variant="white" :to="{ name: 'videos' }">Erst stöbern</GButton>
      </div>
    </GCard>
  </section>
</template>

<style scoped>
.credits {
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

.stand {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex: none;
  padding: 12px 20px;
  border-radius: var(--r-card);
  background: var(--c-dark);
  color: var(--c-on-dark);
}

.stand-zahl {
  font-size: var(--fs-stat);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.einleitung {
  font-size: var(--fs-body);
  color: var(--c-subhead);
}

/* ── Preisliste ─────────────────────────────────────────────────────── */
.preisliste {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 18px;
}

.posten {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 20px 22px;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
}

.posten-wert {
  font-size: var(--fs-stat);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.posten-name {
  font-size: var(--fs-secondary);
  font-weight: 500;
}

.posten-text {
  margin-top: 6px;
  font-size: var(--fs-meta);
  line-height: 1.55;
  color: var(--c-text-muted);
}

.fussnote {
  color: var(--c-text-muted);
}

/* ── Staffel ────────────────────────────────────────────────────────── */
.staffel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
}

.stufe {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.rabatt {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 3px 12px;
  border-radius: var(--r-pill);
  background: var(--c-tint);
  color: var(--c-action);
  font-size: var(--fs-meta);
  font-variant-numeric: tabular-nums;
}

.stufe-name {
  color: var(--c-text-muted);
}

.stufe-preis {
  margin-top: 10px;
  font-size: var(--fs-stat);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.stufe-einzel {
  color: var(--c-text-muted);
}

.stufe-reicht {
  margin: 10px 0 14px;
  font-size: var(--fs-meta);
  line-height: 1.55;
  color: var(--c-text-muted);
}

.meldung {
  font-size: var(--fs-secondary);
}

.meldung.ok {
  color: var(--c-action);
}

.meldung.fehler {
  color: var(--c-red);
}

/* ── Hinweiskarten ──────────────────────────────────────────────────── */
.hinweis {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.hinweis-text {
  font-size: var(--fs-secondary);
  line-height: 1.6;
  color: var(--c-on-dark);
  max-width: 62ch;
}

.hinweis-knoepfe {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
