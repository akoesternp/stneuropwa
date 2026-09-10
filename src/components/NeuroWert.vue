<script setup lang="ts">
/**
 * Ein Betrag in Neuro — Münze plus Zahl.
 *
 * An einer Stelle, weil Beträge an einem Dutzend Orten auftauchen: im Kopf, an
 * der Paketkachel, im Kaufdialog, in Tabellen. Ohne gemeinsame Komponente sähe
 * jeder davon minimal anders aus, und die Münze wäre bei der nächsten Änderung
 * an elf Stellen nachzuziehen.
 *
 * Die Münze ist bewusst kein Bild, sondern ein Buchstabe im Kreis aus CSS: so
 * erbt sie Schriftgröße und Farbe vom Umfeld und sitzt in einer Tabellenzelle
 * genauso richtig wie in einer Überschrift.
 */
withDefaults(
  defineProps<{
    betrag: number
    /**
     * Währungsnamen dahinter ausschreiben. Für Fließtext („kostet N5 Neuro"),
     * nicht für Tabellen und Marken — dort trägt die Münze allein.
     */
    wort?: boolean
  }>(),
  { wort: false },
)
</script>

<template>
  <span class="neuro">
    <span class="muenze" aria-hidden="true">N</span>
    <span class="zahl">{{ betrag }}</span>
    <!--
      Ohne ausgeschriebenes Wort bliebe für einen Screenreader nur eine nackte
      Zahl übrig — die Münze ist für ihn nicht da.
    -->
    <span v-if="wort" class="wort">Neuro</span>
    <span v-else class="visually-hidden">Neuro</span>
  </span>
</template>

<style scoped>
.neuro {
  display: inline-flex;
  align-items: center;
  gap: 0.34em;
  white-space: nowrap;
}

.muenze {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1.32em;
  height: 1.32em;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  font-family: var(--font-num);
  font-size: 0.74em;
  font-weight: 600;
  line-height: 1;
  /* Der Buchstabe sitzt optisch etwas hoch, wenn er nur zentriert wird. */
  padding-top: 0.04em;
}

.zahl {
  font-variant-numeric: tabular-nums;
}
</style>
