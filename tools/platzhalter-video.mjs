#!/usr/bin/env node
/*
 * Baut abspielbare Platzhalter-Videos — ohne ffmpeg und ohne jede Abhängigkeit.
 *
 * Warum überhaupt selbst kodieren: auf dem Rechner ist kein ffmpeg vorhanden,
 * und für ein paar Sekunden Testbild eine Werkzeugkette zu verlangen, hielte
 * die Entwicklungsumgebung unnötig schwer. H.264 kann genau dafür etwas, das
 * kaum jemand benutzt: den Makroblocktyp I_PCM. Er trägt die Bildpunkte
 * unverändert im Datenstrom — keine Transformation, keine Quantisierung, keine
 * Vorhersage. Damit fällt der schwierige Teil eines Kodierers weg, und was
 * bleibt, ist Bitschreiberei nach Syntaxtabelle.
 *
 * Klein bleiben die Dateien trotzdem, weil nur das erste Bild vollständig
 * geschrieben wird. Danach werden je Bild ausschließlich die Makroblöcke neu
 * übertragen, die sich geändert haben — Laufbalken und Zeitanzeige also, rund
 * ein Dutzend von 576. Alles andere sind übersprungene Blöcke (P_Skip), die
 * den vorigen Inhalt unverändert übernehmen und je drei Bit kosten.
 *
 * Da I_PCM verlustfrei ist und der Entblockungsfilter bei QP 0 nicht greift,
 * ist das dekodierte Bild Punkt für Punkt dasselbe wie das gezeichnete.
 *
 * Aufruf:
 *   node tools/platzhalter-video.mjs "Titel der Übung" ziel.mp4 [sekunden]
 */

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/* ── Bildgröße ────────────────────────────────────────────────────────────
 *
 * 512 × 288 ist genau 16:9 und in beiden Richtungen durch 16 teilbar. Damit
 * geht die Makroblock-Rechnung glatt auf und es braucht keinen Beschnitt im
 * Bildparametersatz.
 */
const BREITE = 512
const HOEHE = 288
const MB_SPALTEN = BREITE / 16
const MB_ZEILEN = HOEHE / 16
const MB_ANZAHL = MB_SPALTEN * MB_ZEILEN
const BILDRATE = 12

/* ── Ein Zeichensatz aus 5 × 7 Punkten ───────────────────────────────── */

const ZEICHEN = {
  A: '01110,10001,10001,11111,10001,10001,10001',
  B: '11110,10001,10001,11110,10001,10001,11110',
  C: '01110,10001,10000,10000,10000,10001,01110',
  D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111',
  F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01111',
  H: '10001,10001,10001,11111,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111',
  J: '00111,00010,00010,00010,00010,10010,01100',
  K: '10001,10010,10100,11000,10100,10010,10001',
  L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001',
  N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110',
  P: '11110,10001,10001,11110,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101',
  R: '11110,10001,10001,11110,10100,10010,10001',
  S: '01111,10000,10000,01110,00001,00001,11110',
  T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110',
  V: '10001,10001,10001,10001,10001,01010,00100',
  W: '10001,10001,10001,10101,10101,11011,10001',
  X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100',
  Z: '11111,00001,00010,00100,01000,10000,11111',
  0: '01110,10001,10011,10101,11001,10001,01110',
  1: '00100,01100,00100,00100,00100,00100,01110',
  2: '01110,10001,00001,00010,00100,01000,11111',
  3: '11111,00010,00100,00010,00001,10001,01110',
  4: '00010,00110,01010,10010,11111,00010,00010',
  5: '11111,10000,11110,00001,00001,10001,01110',
  6: '00110,01000,10000,11110,10001,10001,01110',
  7: '11111,00001,00010,00100,01000,01000,01000',
  8: '01110,10001,10001,01110,10001,10001,01110',
  9: '01110,10001,10001,01111,00001,00010,01100',
  ' ': '00000,00000,00000,00000,00000,00000,00000',
  '.': '00000,00000,00000,00000,00000,01100,01100',
  ',': '00000,00000,00000,00000,01100,01100,01000',
  '-': '00000,00000,00000,11111,00000,00000,00000',
  ':': '00000,01100,01100,00000,01100,01100,00000',
  '/': '00001,00010,00010,00100,01000,01000,10000',
  '!': '00100,00100,00100,00100,00100,00000,00100',
  '?': '01110,10001,00001,00010,00100,00000,00100',
  '(': '00010,00100,01000,01000,01000,00100,00010',
  ')': '01000,00100,00010,00010,00010,00100,01000',
}

/** Umlaute ausschreiben — der Zeichensatz kennt nur das Grundalphabet. */
const ERSATZ = { Ä: 'AE', Ö: 'OE', Ü: 'UE', ß: 'SS', É: 'E', È: 'E', Â: 'A' }

function lesbar(text) {
  return [...text.toUpperCase()]
    .map((z) => ERSATZ[z] ?? z)
    .join('')
    .split('')
    .map((z) => (ZEICHEN[z] ? z : ' '))
    .join('')
}

const SCHRITT = 6 // 5 Punkte Zeichen plus einer Lücke
const textBreite = (text, skala) => (lesbar(text).length * SCHRITT - 1) * skala

/* ── Zeichenfläche in RGB ─────────────────────────────────────────────── */

function neuesBild() {
  return new Uint8Array(BREITE * HOEHE * 3)
}

function punkt(bild, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= BREITE || y >= HOEHE) return
  const i = (y * BREITE + x) * 3
  bild[i] = r
  bild[i + 1] = g
  bild[i + 2] = b
}

function rechteck(bild, x, y, breite, hoehe, farbe) {
  for (let dy = 0; dy < hoehe; dy++) for (let dx = 0; dx < breite; dx++) punkt(bild, x + dx, y + dy, farbe)
}

function schreibe(bild, text, x, y, skala, farbe) {
  let stift = x
  for (const zeichen of lesbar(text)) {
    const reihen = ZEICHEN[zeichen].split(',')
    for (let zy = 0; zy < 7; zy++) {
      for (let zx = 0; zx < 5; zx++) {
        if (reihen[zy][zx] !== '1') continue
        rechteck(bild, stift + zx * skala, y + zy * skala, skala, skala, farbe)
      }
    }
    stift += SCHRITT * skala
  }
}

function mittig(bild, text, y, skala, farbe) {
  schreibe(bild, text, Math.round((BREITE - textBreite(text, skala)) / 2), y, skala, farbe)
}

/** Bricht den Titel auf Zeilen um, die in die Breite passen. */
function umbrechen(text, skala, maxBreite) {
  const zeilen = []
  let zeile = ''
  for (const wort of text.split(/\s+/).filter(Boolean)) {
    const versuch = zeile ? `${zeile} ${wort}` : wort
    if (zeile && textBreite(versuch, skala) > maxBreite) {
      zeilen.push(zeile)
      zeile = wort
    } else {
      zeile = versuch
    }
  }
  if (zeile) zeilen.push(zeile)
  return zeilen
}

/* ── Farben ───────────────────────────────────────────────────────────── */

const GRUND_OBEN = [17, 28, 46]
const GRUND_UNTEN = [30, 54, 88]
const HELL = [235, 241, 248]
const GEDAEMPFT = [120, 142, 172]
const AKZENT = [92, 200, 173]
const BALKEN_LEER = [46, 66, 94]

/* ── Ein einzelnes Bild ───────────────────────────────────────────────── */

function zeichneBild(titel, sekunde, gesamtSekunden) {
  const bild = neuesBild()

  // Verlauf als Hintergrund, damit man sofort sieht, dass wirklich ein Video
  // läuft und nicht nur ein Vorschaubild steht.
  for (let y = 0; y < HOEHE; y++) {
    const t = y / (HOEHE - 1)
    const farbe = GRUND_OBEN.map((v, i) => Math.round(v + (GRUND_UNTEN[i] - v) * t))
    rechteck(bild, 0, y, BREITE, 1, farbe)
  }

  schreibe(bild, 'PLATZHALTER', 24, 24, 2, AKZENT)

  const zeilen = umbrechen(titel, 4, BREITE - 48).slice(0, 3)
  const blockHoehe = zeilen.length * 40
  let y = Math.round((HOEHE - blockHoehe) / 2) - 16
  for (const zeile of zeilen) {
    mittig(bild, zeile, y, 4, HELL)
    y += 40
  }
  mittig(bild, 'KEIN ECHTES VIDEO - NUR ZUM TESTEN', y + 12, 1, GEDAEMPFT)

  /*
   * Laufbalken und Zeitangabe liegen bewusst auf ganzen Sechzehnerlinien:
   * so betrifft die Änderung von Bild zu Bild möglichst wenige Makroblöcke,
   * und die Datei bleibt klein.
   */
  const anteil = Math.min(1, sekunde / gesamtSekunden)
  rechteck(bild, 32, 240, BREITE - 64, 8, BALKEN_LEER)
  rechteck(bild, 32, 240, Math.round((BREITE - 64) * anteil), 8, AKZENT)

  const zeit = `${sekunde.toFixed(1)} / ${gesamtSekunden.toFixed(1)} S`
  schreibe(bild, zeit, 32, 256, 2, GEDAEMPFT)

  return bild
}

/* ── RGB nach YUV 4:2:0, BT.601 mit dem üblichen Wertebereich ─────────── */

function nachYuv(bild) {
  const y = new Uint8Array(BREITE * HOEHE)
  const cb = new Uint8Array((BREITE / 2) * (HOEHE / 2))
  const cr = new Uint8Array((BREITE / 2) * (HOEHE / 2))
  const klemme = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

  for (let py = 0; py < HOEHE; py++) {
    for (let px = 0; px < BREITE; px++) {
      const i = (py * BREITE + px) * 3
      const r = bild[i]
      const g = bild[i + 1]
      const b = bild[i + 2]
      y[py * BREITE + px] = klemme(16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255)
    }
  }

  // Die Farbanteile werden über je vier Bildpunkte gemittelt.
  for (let cy = 0; cy < HOEHE / 2; cy++) {
    for (let cx = 0; cx < BREITE / 2; cx++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((cy * 2 + dy) * BREITE + cx * 2 + dx) * 3
          r += bild[i]
          g += bild[i + 1]
          b += bild[i + 2]
        }
      }
      r /= 4
      g /= 4
      b /= 4
      const j = cy * (BREITE / 2) + cx
      cb[j] = klemme(128 + (-37.797 * r - 74.203 * g + 112 * b) / 255)
      cr[j] = klemme(128 + (112 * r - 93.786 * g - 18.214 * b) / 255)
    }
  }

  return { y, cb, cr }
}

/** Die 384 Abtastwerte eines Makroblocks in der Reihenfolge der Syntax. */
function makroblock({ y, cb, cr }, nr) {
  const mbx = (nr % MB_SPALTEN) * 16
  const mby = Math.floor(nr / MB_SPALTEN) * 16
  const werte = new Uint8Array(384)
  let p = 0
  for (let dy = 0; dy < 16; dy++)
    for (let dx = 0; dx < 16; dx++) werte[p++] = y[(mby + dy) * BREITE + mbx + dx]
  for (const ebene of [cb, cr])
    for (let dy = 0; dy < 8; dy++)
      for (let dx = 0; dx < 8; dx++) werte[p++] = ebene[(mby / 2 + dy) * (BREITE / 2) + mbx / 2 + dx]
  return werte
}

/* ── Bitschreiber ─────────────────────────────────────────────────────── */

class Bits {
  constructor() {
    this.bytes = []
    this.rest = 0
    this.offen = 0
  }

  bit(wert) {
    this.rest = (this.rest << 1) | (wert & 1)
    if (++this.offen === 8) {
      this.bytes.push(this.rest)
      this.rest = 0
      this.offen = 0
    }
  }

  u(anzahl, wert) {
    for (let i = anzahl - 1; i >= 0; i--) this.bit((wert >> i) & 1)
  }

  /** Exp-Golomb ohne Vorzeichen. */
  ue(wert) {
    const x = wert + 1
    const laenge = 32 - Math.clz32(x)
    this.u(laenge - 1, 0)
    this.u(laenge, x)
  }

  /** Exp-Golomb mit Vorzeichen. */
  se(wert) {
    this.ue(wert <= 0 ? -2 * wert : 2 * wert - 1)
  }

  /** Mit Nullen auf die nächste Bytegrenze — vor den rohen Bildpunkten. */
  aufBytegrenze() {
    while (this.offen) this.bit(0)
  }

  rohBytes(werte) {
    if (this.offen) throw new Error('Rohdaten nur auf Bytegrenze')
    for (const wert of werte) this.bytes.push(wert)
  }

  /** rbsp_trailing_bits: eine Eins, dann Nullen bis zur Bytegrenze. */
  abschluss() {
    this.bit(1)
    this.aufBytegrenze()
  }

  fertig() {
    if (this.offen) throw new Error('Datenstrom endet mitten im Byte')
    return Buffer.from(this.bytes)
  }
}

/*
 * Startcode-Schutz: drei Nullbytes hintereinander wären ein Startcode. Nach
 * zwei Nullen wird deshalb eine 3 eingeschoben, bevor ein Byte unter 4 folgt.
 * Bei rohen Bildpunkten kommt das dauernd vor — ohne diesen Schritt liefe
 * jeder Dekodierer aus dem Takt.
 */
function startcodeSchutz(rbsp) {
  const raus = []
  let nullen = 0
  for (const b of rbsp) {
    if (nullen >= 2 && b <= 3) {
      raus.push(3)
      nullen = 0
    }
    raus.push(b)
    nullen = b === 0 ? nullen + 1 : 0
  }
  return Buffer.from(raus)
}

const nal = (kopf, rbsp) => Buffer.concat([Buffer.from([kopf]), startcodeSchutz(rbsp)])

/* ── Parametersätze ───────────────────────────────────────────────────── */

function sps() {
  const b = new Bits()
  b.u(8, 66) // profile_idc: Baseline
  b.u(8, 0xc0) // constraint_set0 und 1 gesetzt
  b.u(8, 30) // level_idc 3.0
  b.ue(0) // seq_parameter_set_id
  b.ue(0) // log2_max_frame_num_minus4
  b.ue(2) // pic_order_cnt_type 2: Anzeige- gleich Dekodierreihenfolge
  b.ue(1) // max_num_ref_frames
  b.u(1, 0) // gaps_in_frame_num_value_allowed_flag
  b.ue(MB_SPALTEN - 1)
  b.ue(MB_ZEILEN - 1)
  b.u(1, 1) // frame_mbs_only_flag
  b.u(1, 1) // direct_8x8_inference_flag
  b.u(1, 0) // frame_cropping_flag
  b.u(1, 0) // vui_parameters_present_flag
  b.abschluss()
  return b.fertig()
}

function pps() {
  const b = new Bits()
  b.ue(0) // pic_parameter_set_id
  b.ue(0) // seq_parameter_set_id
  b.u(1, 0) // entropy_coding_mode_flag: CAVLC
  b.u(1, 0) // bottom_field_pic_order_in_frame_present_flag
  b.ue(0) // num_slice_groups_minus1
  b.ue(0) // num_ref_idx_l0_default_active_minus1
  b.ue(0) // num_ref_idx_l1_default_active_minus1
  b.u(1, 0) // weighted_pred_flag
  b.u(2, 0) // weighted_bipred_idc
  b.se(0) // pic_init_qp_minus26
  b.se(0) // pic_init_qs_minus26
  b.se(0) // chroma_qp_index_offset
  b.u(1, 0) // deblocking_filter_control_present_flag
  b.u(1, 0) // constrained_intra_pred_flag
  b.u(1, 0) // redundant_pic_cnt_present_flag
  b.abschluss()
  return b.fertig()
}

/* ── Die beiden Bildarten ─────────────────────────────────────────────── */

/** Das erste Bild: jeder Makroblock trägt seine Bildpunkte selbst. */
function idrBild(yuv) {
  const b = new Bits()
  b.ue(0) // first_mb_in_slice
  b.ue(7) // slice_type: I, und zwar für das ganze Bild
  b.ue(0) // pic_parameter_set_id
  b.u(4, 0) // frame_num
  b.ue(0) // idr_pic_id
  b.u(1, 0) // no_output_of_prior_pics_flag
  b.u(1, 0) // long_term_reference_flag
  b.se(0) // slice_qp_delta

  for (let nr = 0; nr < MB_ANZAHL; nr++) {
    b.ue(25) // mb_type I_PCM
    b.aufBytegrenze()
    b.rohBytes(makroblock(yuv, nr))
  }

  b.abschluss()
  return nal(0x65, b.fertig()) // nal_ref_idc 3, Typ 5 (IDR)
}

/** Folgebild: nur geänderte Makroblöcke, der Rest wird übersprungen. */
function pBild(yuv, vorher, frameNum) {
  const b = new Bits()
  b.ue(0) // first_mb_in_slice
  b.ue(5) // slice_type: P, und zwar für das ganze Bild
  b.ue(0) // pic_parameter_set_id
  b.u(4, frameNum & 15)
  b.u(1, 0) // num_ref_idx_active_override_flag
  b.u(1, 0) // ref_pic_list_modification_flag_l0
  b.u(1, 0) // adaptive_ref_pic_marking_mode_flag
  b.se(0) // slice_qp_delta

  let uebersprungen = 0
  let neu = 0
  for (let nr = 0; nr < MB_ANZAHL; nr++) {
    const jetzt = makroblock(yuv, nr)
    const alt = makroblock(vorher, nr)
    if (Buffer.compare(Buffer.from(jetzt), Buffer.from(alt)) === 0) {
      uebersprungen++
      continue
    }
    b.ue(uebersprungen) // mb_skip_run
    uebersprungen = 0
    b.ue(30) // I_PCM innerhalb eines P-Slice
    b.aufBytegrenze()
    b.rohBytes(jetzt)
    neu++
  }
  if (uebersprungen > 0) b.ue(uebersprungen)

  b.abschluss()
  return { daten: nal(0x41, b.fertig()), neu } // nal_ref_idc 2, Typ 1
}

/* ── MP4-Hülle ───────────────────────────────────────────────────────── */

const u32 = (wert) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(wert >>> 0)
  return b
}
const u16 = (wert) => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(wert)
  return b
}
const box = (typ, ...teile) => {
  const inhalt = Buffer.concat(teile)
  return Buffer.concat([u32(inhalt.length + 8), Buffer.from(typ, 'latin1'), inhalt])
}
const vollBox = (typ, version, flags, ...teile) =>
  box(typ, Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...teile)

const MATRIX = Buffer.concat([
  u32(0x00010000), u32(0), u32(0),
  u32(0), u32(0x00010000), u32(0),
  u32(0), u32(0), u32(0x40000000),
])

/*
 * Der Kopfsatz trägt die Parametersätze als vollständige NAL-Einheiten,
 * also mitsamt ihrem Kopfbyte und mit Startcode-Schutz. Ohne das Kopfbyte
 * hält ein Dekodierer den Satz für etwas ganz anderes, findet nie eine
 * Bildgröße und bricht ab, bevor das erste Bild an die Reihe kommt.
 */
function avcC(spsNal, ppsNal) {
  return box(
    'avcC',
    Buffer.from([1, spsNal[1], spsNal[2], spsNal[3], 0xff, 0xe1]),
    u16(spsNal.length),
    spsNal,
    Buffer.from([1]),
    u16(ppsNal.length),
    ppsNal,
  )
}

function moov(groessen, zeitskala, abstand, spsNal, ppsNal, mdatOffset) {
  const anzahl = groessen.length
  const dauer = anzahl * abstand
  const filmSkala = 1000
  const filmDauer = Math.round((dauer / zeitskala) * filmSkala)

  const mvhd = vollBox('mvhd', 0, 0,
    u32(0), u32(0), u32(filmSkala), u32(filmDauer),
    u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
    MATRIX, Buffer.alloc(24), u32(2))

  const tkhd = vollBox('tkhd', 0, 7,
    u32(0), u32(0), u32(1), u32(0), u32(filmDauer),
    Buffer.alloc(8), u16(0), u16(0), u16(0), u16(0),
    MATRIX, u32(BREITE << 16), u32(HOEHE << 16))

  const mdhd = vollBox('mdhd', 0, 0,
    u32(0), u32(0), u32(zeitskala), u32(dauer), u16(0x55c4), u16(0))

  const hdlr = vollBox('hdlr', 0, 0,
    u32(0), Buffer.from('vide', 'latin1'), Buffer.alloc(12),
    Buffer.from('VideoHandler\0', 'latin1'))

  const beschreibung = box('avc1',
    Buffer.alloc(6), u16(1),
    u16(0), u16(0), u32(0), u32(0), u32(0),
    u16(BREITE), u16(HOEHE),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    Buffer.alloc(32), u16(0x0018), Buffer.from([0xff, 0xff]),
    avcC(spsNal, ppsNal))

  const stbl = box('stbl',
    vollBox('stsd', 0, 0, u32(1), beschreibung),
    vollBox('stts', 0, 0, u32(1), u32(anzahl), u32(abstand)),
    vollBox('stss', 0, 0, u32(1), u32(1)),
    vollBox('stsc', 0, 0, u32(1), u32(1), u32(anzahl), u32(1)),
    vollBox('stsz', 0, 0, u32(0), u32(anzahl), ...groessen.map(u32)),
    vollBox('stco', 0, 0, u32(1), u32(mdatOffset)))

  const minf = box('minf',
    vollBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
    box('dinf', vollBox('dref', 0, 0, u32(1), vollBox('url ', 0, 1))),
    stbl)

  return box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, minf)))
}

/* ── Alles zusammensetzen ────────────────────────────────────────────── */

export function baueVideo(titel, sekunden = 2) {
  const anzahlBilder = Math.max(2, Math.round(sekunden * BILDRATE))
  const gesamt = anzahlBilder / BILDRATE

  const proben = []
  let vorher = null

  for (let i = 0; i < anzahlBilder; i++) {
    const yuv = nachYuv(zeichneBild(titel, i / BILDRATE, gesamt))
    proben.push(vorher === null ? idrBild(yuv) : pBild(yuv, vorher, i).daten)
    vorher = yuv
  }

  // In der MP4-Hülle steht vor jeder Einheit ihre Länge statt eines Startcodes.
  const daten = proben.map((einheit) => Buffer.concat([u32(einheit.length), einheit]))
  const groessen = daten.map((probe) => probe.length)

  const ftyp = box('ftyp',
    Buffer.from('isom', 'latin1'), u32(512),
    Buffer.from('isomiso2avc1mp41', 'latin1'))

  const spsNal = nal(0x67, sps())
  const ppsNal = nal(0x68, pps())
  const zeitskala = BILDRATE * 1000
  const abstand = 1000

  /*
   * Die Kopfdaten stehen vor den Bilddaten, damit ein Browser schon beim ersten
   * Stück weiß, was er vor sich hat. Dafür muss der Versatz auf die Bilddaten
   * bekannt sein — der hängt aber von der Länge der Kopfdaten ab. Also einmal
   * mit Versatz null bauen, um die Länge zu erfahren, und dann richtig.
   */
  const probelauf = moov(groessen, zeitskala, abstand, spsNal, ppsNal, 0)
  const versatz = ftyp.length + probelauf.length + 8
  const kopf = moov(groessen, zeitskala, abstand, spsNal, ppsNal, versatz)
  if (kopf.length !== probelauf.length) throw new Error('Kopfdaten haben ihre Länge geändert')

  const mdat = box('mdat', ...daten)
  return { datei: Buffer.concat([ftyp, kopf, mdat]), anzahlBilder, gesamt }
}

/* ── Aufruf von der Kommandozeile ────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [titel, ziel, sekunden] = process.argv.slice(2)
  if (!titel || !ziel) {
    console.error('Aufruf: node tools/platzhalter-video.mjs "Titel" ziel.mp4 [sekunden]')
    process.exit(1)
  }
  const { datei, anzahlBilder, gesamt } = baueVideo(titel, Number(sekunden) || 2)
  writeFileSync(ziel, datei)
  console.log(
    `${ziel}: ${BREITE}x${HOEHE}, ${anzahlBilder} Bilder, ${gesamt.toFixed(1)} s, ` +
      `${(datei.length / 1024).toFixed(0)} KB`,
  )
}
