<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useBestellungenStore } from '@/stores/bestellungen'
import { ladePaypal } from '@/utils/paypal'
import type { PaypalButtons } from '@/utils/paypal'
import {
  CREDITS_JE_VIDEO,
  CREDIT_BASISPREIS_CENT,
  CREDIT_PAKETE,
  PAKET_RABATT,
  paketPreis,
  preisJeCreditCent,
  rabattProzent,
} from '@shared/types'
import type { Bestellung, CreditPaket } from '@shared/types'

/**
 * Credits kaufen — Preisliste, Staffel und die zwei Zahlwege.
 *
 * Vorkasse und PayPal unterscheiden sich hier nur im letzten Schritt: beide
 * legen dieselbe Bestellung an. Bei Vorkasse bekommt der Käufer danach die
 * Bankverbindung samt Verwendungszweck und wartet auf die Bestätigung; bei
 * PayPal zieht der Server das Geld ein und schreibt sofort gut.
 */
const auth = useAuthStore()
const bestellungen = useBestellungenStore()

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const preis = (cent: number) => euro.format(cent / 100)
const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

const guthaben = computed(() => auth.user?.credits ?? 0)

/** Beispielrechnung für die Preisliste — ein Paket mittlerer Größe. */
const BEISPIEL_UEBUNGEN = 8

/* ── Bestellvorgang ──────────────────────────────────────────────────── */

const gewaehlt = ref<CreditPaket | null>(null)
const zustimmung = ref(false)
const erfolg = ref<string | null>(null)
/** Nach einer Vorkasse-Bestellung: die Überweisungsdaten stehen darin. */
const ueberweisung = ref<Bestellung | null>(null)

const paypalZiel = ref<HTMLElement | null>(null)
const paypalFehler = ref<string | null>(null)
let paypalKnoepfe: PaypalButtons | null = null

/** Die laufende PayPal-Bestellung — zwischen createOrder und onApprove. */
let laufendeBestellung: number | null = null

const paypalMoeglich = computed(() => bestellungen.konfig?.paypal.aktiv ?? false)
const vorkasseMoeglich = computed(() => bestellungen.konfig?.vorkasse.aktiv ?? false)
const irgendeinZahlweg = computed(() => paypalMoeglich.value || vorkasseMoeglich.value)

onMounted(async () => {
  await bestellungen.ladeKonfig()
  await bestellungen.ladeEigene()
})

function waehle(stufe: CreditPaket): void {
  gewaehlt.value = stufe
  zustimmung.value = false
  erfolg.value = null
  ueberweisung.value = null
  paypalFehler.value = null
  bestellungen.zuruecksetzen()
}

function abbrechen(): void {
  gewaehlt.value = null
  ueberweisung.value = null
  zustimmung.value = false
  loesePaypal()
}

/* ── Vorkasse ────────────────────────────────────────────────────────── */

async function bestelleVorkasse(): Promise<void> {
  const stufe = gewaehlt.value
  if (!stufe || !zustimmung.value) return

  const ergebnis = await bestellungen.anlegen(stufe.id, 'vorkasse')
  if (ergebnis) ueberweisung.value = ergebnis.bestellung
}

/* ── PayPal ──────────────────────────────────────────────────────────── */

function loesePaypal(): void {
  // Der Knopf gehört zu einer Bestellung; bleibt er beim Wechsel der Stufe
  // stehen, bezahlt der nächste Klick die alte.
  try {
    paypalKnoepfe?.close()
  } catch {
    // Beim Abräumen eines schon entfernten Knopfs — folgenlos.
  }
  paypalKnoepfe = null
  laufendeBestellung = null
}

/**
 * Baut den PayPal-Knopf auf, sobald eine Stufe gewählt und zugestimmt wurde.
 *
 * Der Vorgang entsteht erst beim Klick (`createOrder`), nicht schon beim
 * Anzeigen: sonst stünde für jede angesehene Stufe eine offene Bestellung in
 * der Tabelle.
 */
watch([gewaehlt, zustimmung, paypalZiel], async ([stufe, zugestimmt, ziel]) => {
  loesePaypal()
  if (!stufe || !zugestimmt || !ziel || !paypalMoeglich.value) return

  ziel.innerHTML = ''
  paypalFehler.value = null

  try {
    const sdk = await ladePaypal(bestellungen.konfig!.paypal.clientId)

    paypalKnoepfe = sdk.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'paypal', height: 46 } as never,

      createOrder: async () => {
        const ergebnis = await bestellungen.anlegen(stufe.id, 'paypal')
        if (!ergebnis?.paypalVorgang) throw new Error(bestellungen.fehler ?? 'Bestellung fehlgeschlagen')
        laufendeBestellung = ergebnis.bestellung.id
        return ergebnis.paypalVorgang
      },

      onApprove: async () => {
        // Der Käufer hat zugestimmt; ob gezahlt wurde, entscheidet der Server.
        if (laufendeBestellung === null) return
        const gelungen = await bestellungen.erfassePaypal(laufendeBestellung)
        if (gelungen) {
          erfolg.value = `${stufe.credits} Credits gutgeschrieben. Ihr Guthaben: ${auth.user?.credits ?? 0}.`
          gewaehlt.value = null
          zustimmung.value = false
        }
        laufendeBestellung = null
      },

      onCancel: () => {
        if (laufendeBestellung !== null) void bestellungen.abbrechen(laufendeBestellung)
        laufendeBestellung = null
      },

      onError: (fehler: unknown) => {
        console.error('[PayPal]', fehler)
        paypalFehler.value = 'PayPal meldet ein Problem. Bitte später erneut versuchen.'
        if (laufendeBestellung !== null) void bestellungen.abbrechen(laufendeBestellung)
        laufendeBestellung = null
      },
    })

    await nextTick()
    if (paypalZiel.value) await paypalKnoepfe.render(paypalZiel.value)
  } catch (cause) {
    console.error('[PayPal]', cause)
    paypalFehler.value = 'PayPal konnte nicht geladen werden.'
  }
})

/* ── Eigene Bestellungen ─────────────────────────────────────────────── */

const offeneBestellungen = computed(() =>
  bestellungen.eigene.filter((eintrag) => eintrag.status === 'offen'),
)

function statusText(eintrag: Bestellung): string {
  if (eintrag.status === 'bezahlt') return 'gutgeschrieben'
  if (eintrag.status === 'storniert') return 'storniert'
  return eintrag.zahlweg === 'vorkasse' ? 'wartet auf Zahlungseingang' : 'nicht abgeschlossen'
}

/**
 * Das größte Paket, das sich mit diesem Guthaben noch bezahlen ließe.
 *
 * Ausgerechnet statt geteilt: durch das Runden in `paketPreis` liegt die
 * Grenze nicht genau bei credits/RABATT.
 */
function reichtFuerPaket(credits: number): number {
  let anzahl = Math.ceil(credits / PAKET_RABATT) + 2
  while (anzahl > 0 && paketPreis(anzahl) > credits) anzahl--
  return anzahl
}
</script>

<template>
  <section class="credits">
    <header class="head">
      <div class="titles">
        <h1 class="t-h2">Credits</h1>
        <p class="t-subhead">
          Mit Credits schalten Sie einzelne Übungen und ganze Pakete frei — dauerhaft, ohne Abo
          und ohne Laufzeit.
        </p>
      </div>

      <span v-if="auth.isAuthenticated" class="stand">
        <span class="stand-zahl">{{ guthaben }}</span>
        <span class="t-meta">{{ guthaben === 1 ? 'Credit' : 'Credits' }} verfügbar</span>
      </span>
    </header>

    <p v-if="erfolg" class="meldung ok" role="status">{{ erfolg }}</p>

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
        Frei zugängliche Übungen bleiben frei: dafür brauchen Sie keine Credits. Alle Preise
        verstehen sich inklusive Umsatzsteuer.
      </p>
    </section>

    <!-- ── Staffel ───────────────────────────────────────────────────── -->
    <section class="block">
      <h2 class="t-h3">Credits kaufen</h2>
      <p class="einleitung">Je mehr auf einmal, desto günstiger der einzelne Credit.</p>

      <p v-if="bestellungen.fehler" class="meldung fehler" role="alert">
        {{ bestellungen.fehler }}
      </p>

      <div class="staffel">
        <GCard
          v-for="stufe in CREDIT_PAKETE"
          :key="stufe.id"
          class="stufe"
          :class="{ aktiv: gewaehlt?.id === stufe.id }"
        >
          <span v-if="rabattProzent(stufe)" class="rabatt">−{{ rabattProzent(stufe) }} %</span>

          <h3 class="t-h3">{{ stufe.credits }} Credits</h3>
          <p class="stufe-name t-meta">{{ stufe.name }}</p>

          <p class="stufe-preis">{{ preis(stufe.preisCent) }}</p>
          <p class="stufe-einzel t-meta">{{ preis(preisJeCreditCent(stufe)) }} je Credit</p>

          <p class="stufe-reicht">
            Reicht für {{ stufe.credits }} einzelne Übungen — oder ein Paket mit bis zu
            {{ reichtFuerPaket(stufe.credits) }}.
          </p>

          <GButton
            v-if="auth.isAuthenticated"
            :variant="gewaehlt?.id === stufe.id ? 'outline' : 'dark'"
            :disabled="!irgendeinZahlweg"
            @click="gewaehlt?.id === stufe.id ? abbrechen() : waehle(stufe)"
          >
            {{ gewaehlt?.id === stufe.id ? 'Andere Stufe' : 'Auswählen' }}
          </GButton>
          <GButton v-else variant="dark" :to="{ name: 'login' }">Anmelden zum Kaufen</GButton>
        </GCard>
      </div>
    </section>

    <!-- ── Bezahlen ──────────────────────────────────────────────────── -->
    <section v-if="gewaehlt" class="block bezahlen">
      <h2 class="t-h3">
        {{ gewaehlt.credits }} Credits für {{ preis(gewaehlt.preisCent) }} — bezahlen
      </h2>

      <!--
        Bei digitalen Inhalten muss der Käufer der sofortigen Ausführung
        zustimmen; ohne diesen Haken bliebe das Widerrufsrecht bestehen,
        obwohl die Credits schon nutzbar wären. Deshalb steht er VOR den
        Zahlwegen und schaltet sie erst frei.
      -->
      <label class="zustimmen">
        <input v-model="zustimmung" type="checkbox" />
        <span>
          Ich verlange ausdrücklich, dass die Credits sofort nach der Zahlung freigeschaltet
          werden, und weiß, dass mein Widerrufsrecht damit erlischt.
        </span>
      </label>

      <p v-if="!zustimmung" class="hinweis t-meta">
        Ohne diese Bestätigung lässt sich nicht bestellen.
      </p>

      <div v-else class="wege">
        <!-- PayPal ------------------------------------------------------->
        <div v-if="paypalMoeglich" class="weg">
          <h3 class="weg-titel">PayPal</h3>
          <p class="weg-text">
            Sofort verfügbar: Die Credits werden Ihrem Konto unmittelbar nach der Zahlung
            gutgeschrieben.
          </p>
          <div ref="paypalZiel" class="paypal-ziel" />
          <p v-if="paypalFehler" class="meldung fehler" role="alert">{{ paypalFehler }}</p>
          <p
            v-if="bestellungen.konfig?.paypal.umgebung === 'sandbox'"
            class="testbetrieb t-meta"
          >
            Testbetrieb — es fließt kein echtes Geld.
          </p>
        </div>

        <!-- Vorkasse ----------------------------------------------------->
        <div v-if="vorkasseMoeglich" class="weg">
          <h3 class="weg-titel">Überweisung (Vorkasse)</h3>

          <template v-if="!ueberweisung">
            <p class="weg-text">
              Sie erhalten Bankverbindung und Verwendungszweck. Freischaltung
              {{ bestellungen.konfig?.vorkasse.dauer }}.
            </p>
            <GButton variant="outline" :disabled="bestellungen.busy" @click="bestelleVorkasse">
              {{ bestellungen.busy ? 'Wird angelegt …' : 'Überweisungsdaten anzeigen' }}
            </GButton>
          </template>

          <!--
            Der Verwendungszweck ist die einzige Brücke zwischen Überweisung
            und Konto — deshalb steht er hervorgehoben und nicht als Fußnote.
          -->
          <div v-else class="ueberweisung">
            <dl class="bankdaten">
              <div><dt>Empfänger</dt><dd>{{ bestellungen.konfig?.vorkasse.empfaenger }}</dd></div>
              <div><dt>IBAN</dt><dd class="mono">{{ bestellungen.konfig?.vorkasse.iban }}</dd></div>
              <div v-if="bestellungen.konfig?.vorkasse.bic">
                <dt>BIC</dt><dd class="mono">{{ bestellungen.konfig?.vorkasse.bic }}</dd>
              </div>
              <div v-if="bestellungen.konfig?.vorkasse.bank">
                <dt>Bank</dt><dd>{{ bestellungen.konfig?.vorkasse.bank }}</dd>
              </div>
              <div><dt>Betrag</dt><dd>{{ preis(ueberweisung.betragCent) }}</dd></div>
            </dl>

            <div class="verwendungszweck">
              <span class="t-eyebrow">Verwendungszweck — bitte genau so angeben</span>
              <strong class="referenz">{{ ueberweisung.referenz }}</strong>
              <p class="hinweis t-meta">
                Ohne diesen Verwendungszweck lässt sich Ihre Zahlung keinem Konto zuordnen und
                die Freischaltung verzögert sich.
              </p>
            </div>

            <p class="weg-text">
              Freigeschaltet wird {{ bestellungen.konfig?.vorkasse.dauer }}. Die Bestellung
              finden Sie unten wieder.
            </p>
          </div>
        </div>
      </div>

      <GButton variant="text" @click="abbrechen">Abbrechen</GButton>
    </section>

    <!-- ── Eigene Bestellungen ───────────────────────────────────────── -->
    <section v-if="auth.isAuthenticated && bestellungen.eigene.length" class="block">
      <h2 class="t-h3">Ihre Bestellungen</h2>
      <p v-if="offeneBestellungen.length" class="einleitung">
        {{ offeneBestellungen.length }}
        {{ offeneBestellungen.length === 1 ? 'Bestellung wartet' : 'Bestellungen warten' }} noch
        auf den Zahlungseingang.
      </p>

      <ul class="bestellliste">
        <li v-for="eintrag in bestellungen.eigene" :key="eintrag.id" class="bestellung">
          <span class="b-referenz mono">{{ eintrag.referenz }}</span>
          <span class="b-menge">{{ eintrag.credits }} Credits</span>
          <span class="b-betrag">{{ preis(eintrag.betragCent) }}</span>
          <span class="b-weg t-meta">
            {{ eintrag.zahlweg === 'paypal' ? 'PayPal' : 'Überweisung' }}
          </span>
          <span class="b-status" :class="eintrag.status">{{ statusText(eintrag) }}</span>
          <span class="b-datum t-meta">{{ datum.format(eintrag.angelegtAm) }}</span>
        </li>
      </ul>
    </section>

    <GCard v-if="!auth.isAuthenticated" variant="gradient" class="hinweis-karte">
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

    <GCard v-else-if="!irgendeinZahlweg" variant="gradient" class="hinweis-karte">
      <h3 class="t-h3">Bezahlung derzeit nicht möglich</h3>
      <p class="hinweis-text">
        Es ist gerade kein Zahlweg eingerichtet. Schreiben Sie uns — wir buchen Ihnen die
        Credits direkt gut.
      </p>
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

/* Die gewählte Stufe bleibt sichtbar, während unten bezahlt wird. */
.stufe.aktiv {
  outline: 2px solid var(--c-action);
  outline-offset: -1px;
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

/* ── Bezahlen ───────────────────────────────────────────────────────── */
.bezahlen {
  padding: 26px;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
  align-items: flex-start;
}

.zustimmen {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  max-width: 72ch;
  font-size: var(--fs-secondary);
  line-height: 1.55;
  cursor: pointer;
}

.zustimmen input {
  margin-top: 3px;
  width: 18px;
  height: 18px;
  flex: none;
  accent-color: var(--c-action);
}

.hinweis {
  color: var(--c-text-muted);
  line-height: 1.5;
}

.wege {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 22px;
  width: 100%;
}

.weg {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  padding: 20px;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-surface);
}

.weg-titel {
  font-size: var(--fs-body);
  font-weight: 600;
}

.weg-text {
  font-size: var(--fs-secondary);
  line-height: 1.55;
  color: var(--c-text-muted);
}

.paypal-ziel {
  width: 100%;
  min-height: 46px;
}

.testbetrieb {
  color: var(--c-action);
}

/* ── Überweisungsdaten ──────────────────────────────────────────────── */
.ueberweisung {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.bankdaten {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bankdaten > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.bankdaten dt {
  font-size: var(--fs-meta);
  color: var(--c-text-muted);
}

.bankdaten dd {
  font-size: var(--fs-secondary);
  font-weight: 500;
  text-align: right;
}

.mono {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}

.verwendungszweck {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 18px;
  border-radius: var(--r-card);
  background: var(--c-dark);
  color: var(--c-on-dark);
}

.referenz {
  font-family: var(--font-num);
  font-size: var(--fs-body);
  letter-spacing: 0.08em;
  color: var(--c-white);
}

.verwendungszweck .hinweis {
  color: var(--c-on-dark);
}

/* ── Bestellliste ───────────────────────────────────────────────────── */
.bestellliste {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.bestellung {
  display: grid;
  grid-template-columns: minmax(140px, auto) auto auto auto 1fr auto;
  align-items: baseline;
  gap: 16px;
  padding: 12px 18px;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
  font-size: var(--fs-secondary);
}

.b-referenz {
  font-size: var(--fs-meta);
  letter-spacing: 0.05em;
}

.b-menge,
.b-betrag {
  font-variant-numeric: tabular-nums;
}

.b-weg,
.b-datum {
  color: var(--c-text-muted);
}

.b-status.bezahlt {
  color: var(--c-action);
  font-weight: 500;
}

.b-status.offen {
  color: var(--c-text-muted);
}

.b-status.storniert {
  color: var(--c-text-muted);
  text-decoration: line-through;
}

@media (max-width: 700px) {
  .bestellung {
    grid-template-columns: 1fr auto;
  }
}

/* ── Meldungen und Hinweiskarten ────────────────────────────────────── */
.meldung {
  font-size: var(--fs-secondary);
}

.meldung.ok {
  color: var(--c-action);
}

.meldung.fehler {
  color: var(--c-red);
}

.hinweis-karte {
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
