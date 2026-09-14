# Inbetriebnahme auf einem frischen Debian-Server

Für `shop.st-neuro.np-dev.de` mit systemd, Apache und MariaDB — auf einem eigenen
Server, auf dem bisher nur **eine andere Webseite** läuft. Außer dieser Seite
ist nichts vorhanden; alles, was stneuro braucht, wird hier von Grund auf
eingerichtet. Die bestehende Seite bleibt dabei unangetastet.

Alle Befehle als `root` bzw. mit `sudo`.

> **Andere Domain?** Dann `shop.st-neuro.np-dev.de` überall ersetzen — in
> `deploy/apache.conf` und in den Befehlen unten.

## Reihenfolge auf einen Blick

| | Schritt | Kurz |
|---|---|---|
| 0 | Bestandsaufnahme | Was läuft schon, was ist belegt? |
| 1 | Systempakete | Apache, MariaDB, git, certbot |
| 2 | Node | 20.19+ oder 22.12+ |
| 3 | MariaDB absichern | Frisch installiert, nur lokal erreichbar |
| 4 | Benutzer und Verzeichnisse | `stneuro`, `/opt/stneuro`, `/var/lib/stneuro` |
| 5 | Deploy Key und Anwendung | Klonen, bauen |
| 6 | Datenbank anlegen | Eigene Datenbank, eigener Benutzer |
| 7 | Umgebungsvariablen | `/etc/stneuro.env` |
| 8 | Dienst | systemd |
| 9 | Apache und Zertifikat | vHost, Let's Encrypt |
| 10 | Abnahme | Von außen prüfen, Admin-Passwort ändern |
| 11 | Sicherung | Täglicher Datenbank-Dump |

---

## Was der Server am Ende hat

### Systempakete

| Was | Wofür | Anmerkung |
|---|---|---|
| **Node 20.19+ oder 22.12+** | Der Dienst selbst und das Bauen | Siehe Schritt 2 — Debian 12 liefert zu alt |
| **npm** | Abhängigkeiten holen, bauen | |
| **MariaDB** | Konten, Pakete, Videos, Sitzungen, Bestellungen | Neu installiert, lauscht nur auf 127.0.0.1 |
| **Apache 2.4** | Reverse Proxy und TLS | Läuft vermutlich schon für die andere Seite |
| **git** | Holt und aktualisiert die Anwendung | |
| **certbot** | Zertifikat für die Subdomain | Über den Prüfpfad (`--webroot`), kein Apache-Plugin nötig |
| **rsync / openssh** | Videodateien hochladen | Meist ohnehin da |

**Nicht** gebraucht wird **ffmpeg** — und das ist Absicht, obwohl es um ein
Videoportal geht. Die Laufzeit liest der Dienst selbst aus dem Dateikopf
(`moov/mvhd`, ein paar hundert Byte), und das Vorschaubild erzeugt der
Browser der Verwaltung. Ein Decoder auf dem Server wäre eine große
Abhängigkeit für zwei Kleinigkeiten.

### Apache-Module

| Modul | Wofür im vHost |
|---|---|
| `ssl` | `SSLEngine` — der ganze 443er vHost |
| `rewrite` | Weiterleitung von Port 80 auf HTTPS |
| `headers` | `X-Forwarded-Proto` (sonst fehlt dem Cookie `Secure`) und die Zwischenspeicher-Regel für `sw.js` |
| `proxy`, `proxy_http` | Durchreichen an 127.0.0.1:3001 |
| `deflate` | Kompression von HTML, JSON und CSS |
| `alias` | Prüfpfad für Let's Encrypt — bei Debian von Haus aus an |

### npm-Pakete

`npm ci` holt alles; kümmern muss man sich um nichts davon einzeln. Der
Unterschied ist trotzdem gut zu wissen:

**Der laufende Dienst braucht genau drei** — mehr lädt `server-dist` nicht:

| Paket | Wofür |
|---|---|
| `express` | HTTP-Server und Routen |
| `mariadb` | Datenbanktreiber |
| `nodemailer` | Bestellbestätigung per SMTP |

Alles andere wird nur zum **Bauen** gebraucht und landet fertig in `dist/`:
`vue`, `vue-router`, `pinia` und `plyr` für die Oberfläche, dazu `vite`,
`vue-tsc`, `typescript`, `@vitejs/plugin-vue`, `vite-plugin-pwa` und die
Typdefinitionen. Nach dem Bauen ließe sich mit `npm prune --omit=dev`
aufräumen — nötig ist es nicht, und beim nächsten Deploy müsste ohnehin
wieder `npm ci` laufen.

### Platz und Speicher

| | Größe |
|---|---|
| `node_modules` | ~120 MB (rund 300 Pakete) |
| `dist` (Oberfläche) | ~1 MB |
| `server-dist` | wenige hundert kB |
| **Videodateien** | so viel, wie du hineinlegst — bis ~1 TB eingeplant |

Die Anwendung selbst ist also winzig; der Platz geht für die Videos drauf.
Deshalb liegt `VIDEO_DIR` außerhalb des Anwendungsverzeichnisses und gehört
auf eine ausreichend große Platte.

### Verzeichnisse

| Pfad | Inhalt |
|---|---|
| `/opt/stneuro` | Heimatverzeichnis des Benutzers `stneuro` (Deploy Key, npm-Zwischenspeicher) |
| `/opt/stneuro/app` | Die Anwendung — ein `git clone`, wird bei jedem Deploy neu gebaut |
| `/var/lib/stneuro/videos` | Videodateien — **nie** im Anwendungsverzeichnis |
| `/var/lib/stneuro/vorschaubilder` | Vorschaubilder |
| `/etc/stneuro.env` | Zugangsdaten und Einstellungen, nur für root lesbar |
| `/var/backups/stneuro` | Tägliche Datenbank-Dumps |
| `/var/www/letsencrypt` | Prüfpfad für die Zertifikatsverlängerung |

Die Anwendung liegt eine Ebene unter dem Heimatverzeichnis, weil `git clone`
ein leeres Ziel verlangt — und im Heimatverzeichnis liegen schon `.ssh` und
später `.npm`.

---

## 0. Bestandsaufnahme

Bevor irgendetwas installiert wird: nachsehen, was die bestehende Webseite
schon belegt. Die Antworten entscheiden über ein paar Schritte weiter unten.

```bash
cat /etc/debian_version                  # 12.x oder 13.x
ss -ltnp                                 # wer hört auf welchem Port
systemctl is-active apache2 nginx mariadb mysql
apache2ctl -S                            # vorhandene vHosts und welcher der Standard ist
df -h                                    # Platz für die Videos
free -h                                  # Arbeitsspeicher fürs Bauen
timedatectl                              # Zeitzone
```

| Befund | Folge |
|---|---|
| Auf 80/443 hört **Apache** | Passt. Apache bekommt nur einen weiteren vHost dazu. |
| Auf 80/443 hört **nginx** | Diese Anleitung passt so nicht — zwei Webserver können nicht beide auf 80/443. Dann gehört eine nginx-Vorlage statt `deploy/apache.conf` her; hier nicht weitermachen. |
| Auf 80/443 hört **nichts** | Die Seite läuft woanders oder gar nicht mehr — erst klären. |
| **MariaDB** läuft schon | Schritt 1 ohne `mariadb-server`, Schritt 3 entfällt; stneuro bekommt in Schritt 6 trotzdem eine eigene Datenbank. |
| **MySQL** läuft schon | Genauso — MySQL behalten, nicht zusätzlich MariaDB installieren (beide wollen Port 3306 und dieselben Pfade). Was anders ist, steht im Kasten unter Schritt 6. |
| Port **3001** ist belegt | Einen anderen freien Port wählen und ihn in `/etc/stneuro.env` (`PORT`) **und** in `deploy/apache.conf` (`ProxyPass`) eintragen. |
| Zeitzone ist nicht Europe/Berlin | `timedatectl set-timezone Europe/Berlin` — sonst läuft die nächtliche Sicherung zur falschen Stunde und die Log-Zeiten sind verschoben. |

`apache2ctl -S` einmal **abspeichern oder abfotografieren**: nach Schritt 9
muss dieselbe Seite wie jetzt als Standard-vHost dastehen.

Außerdem die **Firewall** prüfen (`ufw status` bzw. `nft list ruleset`, dazu
eine etwaige Firewall im Kundenmenü des Hosters): 80 und 443 müssen offen
sein, 3001 und 3306 **nicht**. Mit ufw:

```bash
ufw allow 'WWW Full'      # 80 und 443 — SSH vorher erlaubt lassen!
```

Und im **DNS** den A-Eintrag (bei IPv6 auch AAAA) für `shop.st-neuro.np-dev.de` auf
diesen Server setzen — das dauert eine Weile, bis es überall ankommt, und
ohne ihn gibt es in Schritt 9 kein Zertifikat.

```bash
dig +short shop.st-neuro.np-dev.de A
dig +short shop.st-neuro.np-dev.de AAAA        # leer oder die IPv6 dieses Servers
```

## 1. Systempakete

```bash
apt update
apt install -y sudo apache2 mariadb-server git certbot rsync curl ca-certificates
```

`sudo` fehlt auf einem minimal installierten Debian — die Befehle unten
brauchen es, um als Benutzer `stneuro` zu arbeiten (`sudo -u stneuro -H …`).
Als root muss dafür niemand in die Gruppe `sudo`.

Ist Apache schon da, bleibt es, wie es ist — apt spielt nur fehlende Pakete
nach. Läuft bereits eine MariaDB oder MySQL, `mariadb-server` aus der Liste
nehmen.

## 2. Node

In `package.json` steht `engines: node >= 20.19`. Die Untergrenze kommt von
Vite 6 und den Treibern (mariadb 3.5 und nodemailer 10 verlangen ≥ 20).
**Node 21 fällt heraus** — Vite schließt es ausdrücklich aus. Es muss also
ein *gerades* Hauptversionsband sein: 20, 22 oder neuer.

| Debian | Mitgeliefertes Node | Vorgehen |
|---|---|---|
| **13** (trixie) | 20.19 | Reicht: `apt install -y nodejs npm` |
| **12** (bookworm) | 18 | Zu alt — über NodeSource |

Über NodeSource (Debian 12):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs          # npm ist hier enthalten
```

Danach in beiden Fällen:

```bash
node -v      # muss v20.19+ oder v22.12+ sein
which node   # /usr/bin/node
```

Wer kein Skript aus dem Netz in eine Shell leiten will — verständlich —,
nimmt `nvm` unter dem Benutzer `stneuro`. Der systemd-Dienst ruft
`/usr/bin/node` auf; bei einem anderen Pfad die Zeile `ExecStart` in
`deploy/stneuro.service` anpassen.

## 3. MariaDB absichern

Nur bei frisch installierter MariaDB — lief schon eine, weiter bei Schritt 4.

```bash
systemctl enable --now mariadb
mariadb-secure-installation
```

Die Fragen: kein root-Passwort setzen und nicht auf eine andere
Anmeldeart umstellen — root meldet sich unter Debian über den Unix-Socket an
(`mariadb` als root, ohne `-p`), das ist sicherer als ein Passwort. Anonyme
Benutzer, Test-Datenbank und root-Fernzugriff **entfernen**.

Dann prüfen, dass die Datenbank nur lokal lauscht:

```bash
ss -ltnp | grep 3306       # 127.0.0.1:3306 — nicht 0.0.0.0 und nicht *
```

Debian stellt das von Haus aus so ein (`bind-address = 127.0.0.1` in
`/etc/mysql/mariadb.conf.d/50-server.cnf`). Steht dort etwas anderes, zurück
auf 127.0.0.1 und `systemctl restart mariadb`.

## 4. Benutzer und Verzeichnisse

Ein eigener Systembenutzer ohne Login-Shell — der Dienst braucht keine Rechte
außerhalb der Datenbank und seiner Ablage.

```bash
adduser --system --group --home /opt/stneuro --shell /usr/sbin/nologin stneuro
mkdir -p /opt/stneuro /var/lib/stneuro/videos /var/lib/stneuro/vorschaubilder
chown -R stneuro:stneuro /opt/stneuro /var/lib/stneuro
chmod 750 /opt/stneuro /var/lib/stneuro
```

`/var/lib/stneuro/videos` ist die Ablage der Videodateien (bis zu ~1 TB) und
liegt bewusst **außerhalb** des Anwendungsverzeichnisses — ein Neu-Deploy
darf sie nicht anfassen. Bei der Größenordnung gehört das Verzeichnis auf
eine ausreichend große Platte bzw. ein eigenes Volume; das dann **vor** dem
`mkdir` nach `/var/lib/stneuro` einhängen.

## 5. Deploy Key und Anwendung

Das Repository ist privat; der Server zieht es über einen eigenen Deploy Key
(nur Lesen). `ssh-keygen` legt das `.ssh`-Verzeichnis nicht selbst an:

```bash
install -d -m 700 -o stneuro -g stneuro /opt/stneuro/.ssh
sudo -u stneuro -H ssh-keygen -t ed25519 -f /opt/stneuro/.ssh/id_ed25519 -N '' -C 'stneuro-deploy'
cat /opt/stneuro/.ssh/id_ed25519.pub
```

Den öffentlichen Schlüssel bei GitHub unter
**Repo → Settings → Deploy keys → Add deploy key** eintragen (ohne
Schreibrecht). Dann die Verbindung einmal von Hand aufbauen, damit GitHub in
`known_hosts` landet:

```bash
sudo -u stneuro -H ssh -T git@github.com
```

Der angezeigte Fingerabdruck muss
`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU` lauten (von GitHub
veröffentlicht, ED25519) — erst dann mit `yes` bestätigen. Die Antwort
„successfully authenticated, but GitHub does not provide shell access" ist
der Erfolg.

```bash
sudo -u stneuro -H git clone git@github.com:akoesternp/stneuropwa.git /opt/stneuro/app
cd /opt/stneuro/app
sudo -u stneuro -H npm ci
sudo -u stneuro -H npm run build
```

> **Welcher Zweig?** Der Server zieht `main` — das ist der Stand, der laufen
> soll, und `git clone` holt ihn ohne Zutun. Entwickelt wird auf
> `feat/videoportal`; was fertig ist, wandert von dort nach `main`.

`npm run build` prüft die Typen, baut die Oberfläche nach `dist/` und den
Server nach `server-dist/`.

Beim Bauen braucht `vue-tsc` kurzzeitig spürbar Arbeitsspeicher. Auf einer
kleinen Maschine kann das mit „JavaScript heap out of memory" abbrechen.
Dann entweder mehr geben:

```bash
sudo -u stneuro -H NODE_OPTIONS=--max-old-space-size=2048 npm run build
```

oder — bei unter 2 GB RAM — eine Auslagerungsdatei anlegen, oder auf dem
Arbeitsrechner bauen und nur `dist/` und `server-dist/` hinüberspielen. Der
laufende Dienst selbst ist genügsam.

## 6. Datenbank anlegen

Nutzer, Pakete, Videos und Sitzungen liegen in einer **eigenen** Datenbank
mit eigenem Benutzer:

```bash
mariadb
```

```sql
CREATE DATABASE stneuro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'stneuro'@'localhost' IDENTIFIED BY '<langes Passwort>';
CREATE USER 'stneuro'@'127.0.0.1' IDENTIFIED BY '<dasselbe Passwort>';
GRANT ALL PRIVILEGES ON stneuro.* TO 'stneuro'@'localhost';
GRANT ALL PRIVILEGES ON stneuro.* TO 'stneuro'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Warum zweimal: der Dienst und die Sicherung verbinden sich über TCP mit
`127.0.0.1`, der Kommandozeilen-Client ohne `-h` über den Socket als
`localhost`. Für MariaDB sind das zwei verschiedene Absender — mit nur einem
Eintrag scheitert je nach Namensauflösung einer der beiden Wege mit
„Access denied", obwohl das Passwort stimmt.

Das Passwort ohne `'` und ohne Leerzeichen wählen, dann gibt es auch in
`/etc/stneuro.env` nichts zu maskieren.

Die Tabellen legt der Dienst beim ersten Start selbst an — es gibt kein
separates Schema-Skript, das aus dem Tritt geraten könnte.

### Wenn MySQL statt MariaDB läuft

Erst klären, was es wirklich ist — unter Debian heißen beide gern `mysql`
(der Befehl `mysql` und der Dienst `mysql.service` sind dort oft nur andere
Namen für MariaDB):

```bash
mysql --version            # enthält "MariaDB" → es ist MariaDB, alles wie oben
mysql -u root -p -e 'SELECT VERSION();'
```

Ist es tatsächlich **MySQL**, dann muss es **8.0 oder neuer** sein. stneuro
läuft damit ohne Änderung — das Schema benutzt nichts, was nur MariaDB
kennt, und der Dienst meldet sich auch mit MySQLs Standardverfahren
(`caching_sha2_password`) an. Anders ist nur das Drumherum:

| Statt | bei MySQL |
|---|---|
| `mariadb` | `mysql -u root -p` — oder nur `mysql`, wenn root über den Socket angemeldet ist |
| `mariadb-dump` | `mysqldump` — `deploy/backup.sh` nimmt von selbst, was da ist |
| `mariadb-secure-installation` (Schritt 3) | entfällt, die bestehende Installation ist ja eingerichtet |

Die SQL-Befehle oben gelten unverändert. Den zweiten Benutzer für
`127.0.0.1` braucht MySQL genauso.

## 7. Umgebungsvariablen

```bash
cp /opt/stneuro/app/.env.example /etc/stneuro.env
chmod 600 /etc/stneuro.env
nano /etc/stneuro.env
```

Die Datei gehört root; systemd liest sie vor dem Wechsel auf den Benutzer
`stneuro` ein. Mindestens setzen:

```
PORT=3001
HOST=127.0.0.1
SECURE_COOKIES=1
VIDEO_DIR=/var/lib/stneuro/videos
THUMB_DIR=/var/lib/stneuro/vorschaubilder
ADMIN_USER=admin
ADMIN_PASSWORD=<einmalig ein langes Passwort>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=stneuro
DB_USER=stneuro
DB_PASSWORD=<das Passwort aus Schritt 6>
```

`HOST=127.0.0.1` ist wichtig: sonst ist die Anwendung unter Umgehung von
Apache direkt auf Port 3001 erreichbar — also ohne HTTPS.

Ohne erreichbare Datenbank startet der Dienst nicht — lieber gar nicht als
ein Portal, an dem sich niemand anmelden kann.

### Sobald Guthaben verkauft wird

Ohne diese Angaben läuft das Portal, aber niemand kann Neuro kaufen: die
Zahlwege sind dann schlicht aus, und auf der Neuro-Seite steht kein Knopf.

```
# Überweisung. Ohne IBAN ist der Zahlweg aus — eine Überweisungsmaske ohne
# Empfänger wäre schlimmer als gar keine.
VORKASSE_EMPFAENGER=<Kontoinhaber>
VORKASSE_IBAN=<IBAN>
VORKASSE_BIC=<BIC>
VORKASSE_BANK=<Bank>

# PayPal. Ohne CLIENT_ID und SECRET ist der Zahlweg aus.
# PAYPAL_ENV bleibt ohne Angabe auf "sandbox" — wer die Umgebung vergisst,
# testet, statt versehentlich echtes Geld einzuziehen.
PAYPAL_ENV=live
PAYPAL_CLIENT_ID=<aus dem PayPal-Dashboard, Reiter Live>
PAYPAL_SECRET=<dito>

# Postausgang für die Bestellbestätigung. NICHT verzichtbar, siehe unten.
SMTP_HOST=<Mailserver>
SMTP_PORT=587
SMTP_USER=<Postfach>
SMTP_PASSWORT=<Passwort>
MAIL_ABSENDER=<Absenderadresse>
MAIL_BETREIBER=stneuro

# Adresse für Rückfragen — steht in der Fußzeile und bei den Bestellungen.
KONTAKT_EMAIL=<Adresse>
```

**Der Postausgang ist keine Bequemlichkeit.** Bei digitalen Inhalten
erlischt das Widerrufsrecht nur, wenn der Käufer eine Bestätigung auf einem
dauerhaften Datenträger erhalten hat (§ 356 Abs. 6 Nr. 2 Buchst. d BGB
verweist auf § 312f). Fehlt sie, bleibt das Widerrufsrecht bestehen — trotz
des Hakens beim Kauf. Ohne `SMTP_HOST` warnt der Dienst bei jeder Buchung
im Log; die Bestellung selbst geht trotzdem durch.

Auf dem neuen Server läuft **kein eigener Mailserver**, und das soll auch so
bleiben: der Dienst gibt die Mails über SMTP an ein bestehendes Postfach ab
(Hoster, Microsoft 365, …). Die Absenderadresse muss zu genau diesem Postfach
bzw. seiner Domain gehören (SPF, DKIM) — sonst landet die Bestätigung im
Spam, und man merkt es erst, wenn sich jemand beschwert. Manche Hoster
sperren ausgehend Port 25; 587 ist davon in der Regel nicht betroffen.

### Feineinstellung

```
# Startguthaben für ein neu registriertes Konto. Ohne Angabe 0.
# Zeitlich begrenzte Zugaben gehören NICHT hierher, sondern ins Backend
# unter „Aktionen" — samt Zeitraum und Obergrenze.
START_CREDITS=0

# Nach wie vielen Tagen ohne Zahlungseingang eine Bestellung als
# abgelaufen gilt. Sie verschwindet nicht, sie rutscht nur aus der
# Arbeitsliste — buchen lässt sie sich weiterhin. Ohne Angabe 14.
BESTELLUNG_VERFALL_TAGE=14
```

## 8. Dienst einrichten

```bash
cp /opt/stneuro/app/deploy/stneuro.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now stneuro

systemctl status stneuro
journalctl -u stneuro -n 30
```

Im Log muss stehen:

```
Datenbank: stneuro auf 127.0.0.1:3306
Videoverzeichnis: /var/lib/stneuro/videos
  Admin angelegt: admin (Passwort aus ADMIN_PASSWORD)
  Beispieldaten angelegt: 2 Pakete, 6 Video-Kacheln
stneuro-Server läuft auf http://127.0.0.1:3001
```

Lokal gegenprüfen, noch ohne Apache:

```bash
curl -sI http://127.0.0.1:3001/ | head -1     # HTTP/1.1 200 OK
```

Bricht der Start mit „MariaDB nicht erreichbar" ab, stimmen die
`DB_*`-Variablen nicht oder MariaDB läuft nicht.

Meldet der Start „Port 3001 lässt sich nicht belegen", läuft der Dienst
schon oder etwas anderes hört dort zu — `ss -ltnp | grep 3001` zeigt, wer.

## 9. Apache und Zertifikat

Das Zertifikat ist ein Henne-Ei-Problem: Let's Encrypt prüft über Port 80,
der 443er vHost braucht aber schon das Zertifikat. `deploy/apache.conf` löst
das selbst — der 443er Teil steht in einer `<IfFile>`-Klammer und bleibt aus,
bis das Zertifikat existiert. Die Datei lässt sich deshalb schon **vor**
certbot aktivieren, ohne dass `apachectl configtest` scheitert.

### Module einschalten

```bash
a2enmod ssl rewrite headers proxy proxy_http deflate
apachectl configtest && systemctl restart apache2
```

Alle sind nötig, keines ist Beiwerk (Tabelle oben). Fehlt eines, scheitert
schon `apachectl configtest` mit „Invalid command". Neue Module brauchen
einen Neustart statt eines Reloads — die bestehende Seite ist dabei für
einen Augenblick weg.

`ssl` lässt Apache zusätzlich auf 443 lauschen; lief die bestehende Seite
bisher nur über http, ändert das für sie nichts.

### vHost aktivieren

```bash
mkdir -p /var/www/letsencrypt
cp /opt/stneuro/app/deploy/apache.conf /etc/apache2/sites-available/shop.st-neuro.np-dev.de.conf
a2ensite shop.st-neuro.np-dev.de
apachectl configtest && systemctl reload apache2
```

**Nichts** an der Konfiguration der bestehenden Seite ändern und kein
`a2dissite` — stneuro kommt nur dazu. Jetzt `apache2ctl -S` mit dem Stand aus
Schritt 0 vergleichen: als Standard-Server („default server") für `*:80` und
`*:443` muss dieselbe Seite wie vorher dastehen. Apache nimmt je Port den
vHost, der alphabetisch zuerst geladen wird; ist das plötzlich stneuro, die
Datei unter einem später einsortierten Namen ablegen (z. B.
`zz-shop.st-neuro.np-dev.de.conf`) — sonst landet jeder Aufruf ohne passenden
Namen, etwa über die nackte IP, im Videoportal.

Prüfen, dass der Prüfpfad von außen erreichbar ist:

```bash
mkdir -p /var/www/letsencrypt/.well-known/acme-challenge
echo ok > /var/www/letsencrypt/.well-known/acme-challenge/probe
curl -s http://shop.st-neuro.np-dev.de/.well-known/acme-challenge/probe    # ok
rm /var/www/letsencrypt/.well-known/acme-challenge/probe
```

Kommt statt `ok` eine Weiterleitung oder die andere Webseite, stimmt DNS
noch nicht oder der vHost ist nicht aktiv — dann scheitert auch certbot.

### Übergangsweise ohne HTTPS

Solange es kein Zertifikat gibt, leitet der Port-80-vHost **nicht** auf
HTTPS weiter, sondern liefert das Portal unverschlüsselt aus. So lässt sich
alles andere schon einrichten und ausprobieren; nach certbot und einem
Reload schaltet dieselbe Datei von selbst auf Weiterleitung um.

Dafür in `/etc/stneuro.env` vorübergehend:

```
SECURE_COOKIES=0
```

```bash
systemctl restart stneuro
curl -sI http://shop.st-neuro.np-dev.de/ | head -1     # 200, nicht 301
```

Mit `SECURE_COOKIES=1` verwirft der Browser das Sitzungscookie über http:
die Anmeldung scheint zu klappen, man fliegt aber sofort wieder raus.

Zeigt der DNS-Eintrag noch nicht auf den Server, lässt sich trotzdem
testen — auf dem Arbeitsrechner in
`C:\Windows\System32\drivers\etc\hosts` (als Administrator bearbeiten) eine
Zeile `<IP des Servers> shop.st-neuro.np-dev.de` eintragen und danach wieder
entfernen.

Solange es so läuft, geht **alles im Klartext** übers Netz, auch Passwörter.
Also nur zum Einrichten, nicht mit echten Kunden. Der Service Worker
registriert sich ohne HTTPS nicht; installieren lässt sich die App erst
danach.

**Sobald das Zertifikat da ist** (nächster Abschnitt): `SECURE_COOKIES=1`,
`systemctl restart stneuro` — und das Admin-Passwort ändern, weil es bis
dahin unverschlüsselt unterwegs war.

### Zertifikat holen

```bash
certbot certonly --webroot -w /var/www/letsencrypt -d shop.st-neuro.np-dev.de \
  --deploy-hook "systemctl reload apache2"
systemctl reload apache2
```

Beim ersten Aufruf fragt certbot nach einer E-Mail-Adresse (Warnungen vor
Ablauf) und den Nutzungsbedingungen.

`--deploy-hook` ist **nicht** optional: mit `--webroot` fasst certbot Apache
selbst nicht an. Ohne den Haken läge nach der Verlängerung zwar ein neues
Zertifikat auf der Platte, Apache lieferte aber bis zum nächsten Neustart das
alte aus — und nach 90 Tagen ist die Seite „nicht sicher". Der Haken wird in
der Verlängerungskonfiguration gespeichert und gilt für alle künftigen Läufe.

Verlängert wird automatisch über den systemd-Timer aus dem certbot-Paket.
Einmal durchspielen:

```bash
systemctl list-timers | grep certbot
certbot renew --dry-run
```

Hat die bestehende Seite ihr Zertifikat über `certbot --apache` bekommen,
stört sich das nicht: jedes Zertifikat verlängert sich nach seiner eigenen
Konfiguration.

## 10. Abnahme

```bash
curl -I  https://shop.st-neuro.np-dev.de/                     # 200
curl -sI http://shop.st-neuro.np-dev.de/ | head -1            # 301 auf https
curl -s  https://shop.st-neuro.np-dev.de/api/portal/videos    # JSON mit den öffentlichen Kacheln
curl -s  https://shop.st-neuro.np-dev.de/api/admin/health     # {"error":"Nicht angemeldet."}
```

Und die Wege, über die Geld hereinkommt:

```bash
# Zeigt, welche Zahlwege scharf sind — beide müssen auf true stehen,
# und PayPal auf "live", nicht "sandbox".
curl -s https://shop.st-neuro.np-dev.de/api/portal/zahlung/konfig

# Die Kontaktadresse aus KONTAKT_EMAIL.
curl -s https://shop.st-neuro.np-dev.de/api/portal/kontakt
```

Von außen — also **vom Arbeitsrechner**, nicht auf dem Server — dürfen
Port 3001 und die Datenbank **nicht** erreichbar sein:

```bash
curl --max-time 5 http://shop.st-neuro.np-dev.de:3001/   # muss scheitern
nc -vz -w 5 shop.st-neuro.np-dev.de 3306                 # muss scheitern
```

Und die bestehende Webseite einmal im Browser aufrufen — sie muss aussehen
wie vorher.

Dann im Browser unter `/admin` anmelden und **sofort das Admin-Passwort
ändern** (Verwaltung → Zugänge). Anschließend `ADMIN_PASSWORD` aus
`/etc/stneuro.env` entfernen und `systemctl restart stneuro` — sonst wird das
Passwort bei jedem Neustart wieder überschrieben.

## 11. Sicherung einrichten

Die **Datenbank** sichert `deploy/backup.sh` nach `/var/backups/stneuro/`
(Zugangsdaten liest es aus `/etc/stneuro.env`, alte Stände räumt es nach 14
Tagen selbst weg). Die **Videodateien** sind bewusst nicht dabei — 1 TB
täglich zu dumpen wäre Unsinn. Die **Vorschaubilder** ebenso wenig: sie lassen
sich in der Verwaltung jederzeit neu erzeugen. Wenn die Originale nicht
ohnehin anderswo liegen, gehört das Videoverzeichnis in einen separaten
rsync-Spiegel.

```bash
cp /opt/stneuro/app/deploy/backup.cron /etc/cron.d/stneuro-backup

# Einmal von Hand laufen lassen und das Ergebnis ansehen:
sh /opt/stneuro/app/deploy/backup.sh
ls -lh /var/backups/stneuro/
```

Die Dumps liegen auf demselben Server — gegen einen Plattenschaden hilft das
nicht. `/var/backups/stneuro` gehört deshalb zusätzlich auf einen anderen
Rechner (Backup-Speicher des Hosters, rsync nach außen). Sichert die
bestehende Webseite schon irgendwohin, lässt sich das Verzeichnis dort
anhängen.

Zum Zurückspielen: Dienst stoppen,
`zcat db-<datum>.sql.gz | mariadb stneuro` einspielen (als root; bei MySQL
`mysql` statt `mariadb`), Dienst starten.

---

## Bevor echtes Geld fließt

Drei Dinge, die nicht am Server hängen, aber vor dem ersten echten Kauf
erledigt sein müssen.

**1. Die Pflichttexte.** Impressum, Datenschutz und Widerrufsbelehrung sind
im Portal als Platzhalter angelegt (`/impressum`, `/datenschutz`,
`/widerruf`) — sie sagen offen, dass der Text noch fehlt, und listen auf,
was hineingehört. Solange die Widerrufsbelehrung nicht steht, beginnt die
Widerrufsfrist nicht zu laufen (§ 356 Abs. 3 BGB). Die Texte gehören zu
jemandem mit Zulassung, nicht in dieses Projekt.

**2. PayPal von Sandbox auf Live.** Die Zugangsdaten sind andere als die
der Sandbox; `PAYPAL_ENV=live` allein reicht nicht. Nach der Umstellung
einen echten Kauf über den kleinsten Betrag machen und ihn anschließend im
Backend erstatten — dann ist beides einmal gelaufen.

**3. Ein Geschäftskonto bei PayPal.** Zahlungen entgegennehmen kann nur
ein solches; ein Privatkonto lässt sich kostenlos umstellen.

Ebenfalls prüfen: Auf der Neuro-Seite steht „Alle Preise verstehen sich
inklusive Umsatzsteuer". Wer Kleinunternehmer nach § 19 UStG ist, muss
diesen Satz ändern.

---

## Aktualisieren

```bash
cd /opt/stneuro/app
sudo -u stneuro -H git pull
sudo -u stneuro -H npm ci
sudo -u stneuro -H npm run build
systemctl restart stneuro
```

Hat sich dabei etwas unter `deploy/` geändert (Dienst, vHost, Cron), wird das
**nicht** von selbst übernommen — die Kopien in `/etc` sind eigenständig.
`git pull` zeigt die geänderten Dateien; dann den passenden Schritt oben
wiederholen.

Angemeldet bleiben die Nutzer über die Aktualisierung hinweg, weil die
Sitzungen in der Datenbank liegen.

Nach dem Neustart im Browser einmal hart neu laden (Strg+Umschalt+R). Der
Service Worker zieht sonst unter Umständen noch die alte Fassung aus dem
Zwischenspeicher.

Das System selbst (Apache, MariaDB, Node aus NodeSource) kommt über
`apt update && apt upgrade` — oder automatisch mit `unattended-upgrades`,
falls die bestehende Seite das nicht ohnehin schon eingerichtet hat.

## Sitzungen

Die laufenden Anmeldungen stehen in der Tabelle `sessions`, damit ein Deploy
niemanden abmeldet. Die Tabelle enthält gültige Sitzungskennungen und ist
damit so schützenswert wie die Passwort-Hashes.

Alle Anmeldungen auf einmal beenden:

```bash
systemctl stop stneuro
mariadb stneuro -e 'DELETE FROM sessions;'    # bei MySQL: mysql statt mariadb
systemctl start stneuro
```

## Videodateien einspielen

Zwei Wege — beide landen in `/var/lib/stneuro/videos/`:

**1. Upload in der Verwaltung** (Videos → Neues Video → Datei wählen). Der
Browser überträgt die Datei direkt in die Ablage; Titel und Dauer werden aus
dem Ergebnis vorbelegt. Bequem für den Alltag.

**2. SFTP/rsync** — für sehr große Dateien der verlässlichere Weg, weil kein
Browserfenster offenbleiben muss:

```bash
# vom Arbeitsrechner — root bzw. der SSH-Benutzer, mit dem du dich anmeldest
rsync -av --progress *.mp4 root@shop.st-neuro.np-dev.de:/var/lib/stneuro/videos/
ssh root@shop.st-neuro.np-dev.de 'chown stneuro:stneuro /var/lib/stneuro/videos/*'
```

Danach in der Verwaltung (**Videos → Bearbeiten → Videodatei**) die Datei mit
der Kachel verknüpfen — die Auswahl zeigt alles, was im Verzeichnis liegt,
mit ausgelesener Laufzeit. Kein Neustart nötig.

Empfohlenes Format: **MP4 (H.264/AAC)** — spielt in jedem Browser, lässt sich
per Range-Request anspulen, und die Laufzeit liest der Dienst selbst aus dem
Dateikopf (`moov/mvhd`, ohne ffmpeg). Bei WebM bleibt das Dauer-Feld leer und
wird von Hand eingetragen.

> **Apache und große Uploads:** `LimitRequestBody` ist per Vorgabe unbegrenzt,
> und der vHost hebt es für den Upload-Pfad ausdrücklich auf. Hat die
> bestehende Seite global einen Wert gesetzt, greift trotzdem der aus dem
> vHost. Node bricht solche Anfragen nicht ab (`requestTimeout` ist im Dienst
> abgeschaltet), und `ProxyTimeout` steht im vHost auf einer Stunde.

Ausgeliefert werden die Dateien ausschließlich über
`/api/portal/videos/:id/stream` nach Berechtigungsprüfung (Sitzung → Paket
bzw. Einzelfreischaltung). Es gibt **keinen** direkten Apache-Pfad auf das
Verzeichnis — den darf es auch nie geben, sonst wäre die Freischaltung
wirkungslos.

## Vorschaubilder

Jede Kachel zeigt ein Einzelbild aus dem Video (Vorgabe: Sekunde 3). Erzeugt
wird es **im Browser der Verwaltung** — beim Hochladen automatisch, für per
SFTP abgelegte Dateien über „Aus Video erzeugen" in der Videomaske. Der
Server bekommt nur das fertige JPEG und legt es unter der Video-ID in
`THUMB_DIR` ab.

Deshalb braucht der Server **kein ffmpeg**: ein Einzelbild aus einem Video zu
holen hieße, den Datenstrom zu decodieren — der Browser hat diesen Decoder
ohnehin, sonst könnte er das Video nicht abspielen.

Die Bilder sind absichtlich **öffentlich** (`/api/portal/videos/:id/thumb`,
ohne Berechtigungsprüfung): sie stehen auch an gesperrten Kacheln, so wie
Titel und Laufzeit, und beschreiben das Angebot. Fehlt ein Bild, antwortet
der Endpunkt mit 404 und die Kachel fällt auf ihren Farbverlauf zurück.

Ist der Anfang eines Videos schwarz, lässt sich in der Videomaske eine andere
Sekunde wählen und das Bild neu erzeugen. Alternativ nimmt die Maske auch ein
selbst gewähltes Bild entgegen (PNG, WebP oder JPEG — sie rechnet es um).

### Nichts wird von der Platte gelöscht

Ein Video hat genau **eine** Datei. Solange eine verknüpft ist, bietet die
Maske weder Upload noch Auswahl an — erst „Entfernen" macht den Platz wieder
frei.

Weder „Entfernen" noch das Löschen eines Videos fasst die Dateien in
`VIDEO_DIR` an; sie bleiben liegen und lassen sich erneut auswählen.
Vorschaubilder ebenso: beim Löschen eines Videos wird das Bild lediglich nach
`geloescht-<id>-<zeitstempel>.jpg` umbenannt. Das Umbenennen ist nötig, weil
die Dateien nach der Video-ID heißen und InnoDB den AUTO_INCREMENT-Zähler
nach einem Neustart auf `MAX(id)+1` zurücksetzt — ein später angelegtes Video
könnte sonst dieselbe ID und damit stillschweigend das fremde Bild bekommen.

Aufräumen ist damit Handarbeit — bewusst so: was einmal mühsam per SFTP
hochgeladen wurde, soll kein Fehlklick kosten.

```bash
# Vorschaubilder abgekoppelter Videos ansehen und ggf. wegräumen
ls -lh /var/lib/stneuro/vorschaubilder/geloescht-*.jpg
```

## Wenn etwas nicht läuft

| Symptom | Ursache |
|---|---|
| `502 Bad Gateway` / `503 Service Unavailable` | Dienst läuft nicht — `journalctl -u stneuro -n 50` |
| Dienst startet nicht, Log: „MariaDB nicht erreichbar" | MariaDB läuft nicht oder `DB_*`-Variablen falsch |
| Log: „Access denied for user 'stneuro'@…" | Benutzer nur für `localhost` **oder** `127.0.0.1` angelegt — Schritt 6, beide |
| `git clone`: „Permission denied (publickey)" | Deploy Key nicht bei GitHub eingetragen, oder ohne `sudo -u stneuro -H` geklont |
| `npm run build` bricht mit „heap out of memory" ab | Zu wenig RAM — Schritt 5, `NODE_OPTIONS` oder Auslagerungsdatei |
| `apachectl configtest`: „Invalid command …" | Ein Modul fehlt — Schritt 9, `a2enmod` |
| certbot: „Timeout during connect" / „unauthorized" | DNS zeigt (noch) nicht hierher, AAAA-Eintrag auf falsche IPv6, oder Port 80 in der Firewall zu |
| https zeigt ein Zertifikat der anderen Seite | Zertifikat noch nicht geholt oder Apache danach nicht neu geladen — der 443er Teil ist dann noch aus |
| Die andere Webseite zeigt plötzlich das Videoportal | Reihenfolge der vHosts — Schritt 9, `apache2ctl -S` |
| Anmeldung klappt, fliegt aber sofort wieder raus | `SECURE_COOKIES=1` ohne HTTPS |
| Nach Deploy alter Stand im Browser | Service Worker — einmal hart neu laden |
| Keine Bestellbestätigung, Log warnt bei der Buchung | `SMTP_*` fehlt oder Postfach lehnt ab |
