# Inbetriebnahme auf dem Debian-Server (NP-FritzGoebel)

Für `stneuro.np-dev.de` mit systemd und Apache — nach demselben Muster wie das
Händlerportal auf diesem Server. Alle Befehle als `root` bzw. mit `sudo`.

**Voraussetzung:** Node **20.19+** oder **22.12+** (Vite 6 verlangt das),
Apache mit `mod_proxy`, git, MariaDB (läuft bereits fürs Händlerportal).

```bash
node -v      # muss v20.19+ oder v22.12+ sein
```

**Ports:** Das Händlerportal belegt 3000 — stneuro nimmt **3001**.

---

## 1. Benutzer und Verzeichnis

Ein eigener Systembenutzer ohne Login-Shell — der Dienst braucht keine Rechte
außerhalb der Datenbank.

```bash
adduser --system --group --home /opt/stneuro --shell /usr/sbin/nologin stneuro
mkdir -p /opt/stneuro /var/lib/stneuro/videos
chown -R stneuro:stneuro /opt/stneuro /var/lib/stneuro
chmod 750 /var/lib/stneuro
```

`/var/lib/stneuro/videos` ist die Ablage der Videodateien (bis zu ~1 TB) und
liegt bewusst **außerhalb** des Anwendungsverzeichnisses — ein Neu-Deploy
darf sie nicht anfassen. Bei der Größenordnung gehört das Verzeichnis auf
eine ausreichend große Platte bzw. ein eigenes Volume.

## 2. Deploy Key und Anwendung holen

Das Repository ist privat; der Server zieht es über einen eigenen Deploy Key
(nur Lesen):

```bash
sudo -u stneuro ssh-keygen -t ed25519 -f /opt/stneuro/.ssh/id_ed25519 -N '' -C 'stneuro-deploy'
cat /opt/stneuro/.ssh/id_ed25519.pub
```

Den öffentlichen Schlüssel bei GitHub unter
**Repo → Settings → Deploy keys → Add deploy key** eintragen (ohne
Schreibrecht). Dann:

```bash
cd /opt/stneuro
sudo -u stneuro git clone git@github.com:akoesternp/stneuro.git .

sudo -u stneuro npm ci
sudo -u stneuro npm run build
```

`npm run build` prüft die Typen, baut die Oberfläche nach `dist/` und den
Server nach `server-dist/`.

## 3. Datenbank anlegen

Nutzer, Pakete, Videos und Sitzungen liegen in MariaDB — derselben Instanz,
die schon das Händlerportal nutzt, aber in einer **eigenen** Datenbank mit
eigenem Benutzer:

```bash
mariadb -u root -p
```

```sql
CREATE DATABASE stneuro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'stneuro'@'localhost' IDENTIFIED BY '<langes Passwort>';
GRANT ALL PRIVILEGES ON stneuro.* TO 'stneuro'@'localhost';
FLUSH PRIVILEGES;
```

Die Tabellen legt der Dienst beim ersten Start selbst an — es gibt kein
separates Schema-Skript, das aus dem Tritt geraten könnte.

## 4. Umgebungsvariablen

```bash
cp /opt/stneuro/.env.example /etc/stneuro.env
chmod 600 /etc/stneuro.env
nano /etc/stneuro.env
```

Mindestens setzen:

```
PORT=3001
HOST=127.0.0.1
SECURE_COOKIES=1
VIDEO_DIR=/var/lib/stneuro/videos
ADMIN_USER=admin
ADMIN_PASSWORD=<einmalig ein langes Passwort>
DB_HOST=127.0.0.1
DB_NAME=stneuro
DB_USER=stneuro
DB_PASSWORD=<das Passwort aus Schritt 3>
```

Ohne erreichbare Datenbank startet der Dienst nicht — lieber gar nicht als
ein Portal, an dem sich niemand anmelden kann.

`HOST=127.0.0.1` ist wichtig: sonst ist die Anwendung unter Umgehung von
Apache direkt auf Port 3001 erreichbar — also ohne HTTPS.

## 5. Dienst einrichten

```bash
cp /opt/stneuro/deploy/stneuro.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now stneuro

systemctl status stneuro
journalctl -u stneuro -n 30
```

Im Log muss stehen:

```
Datenbank: stneuro auf 127.0.0.1:3306
  Admin angelegt: admin / …
  Beispieldaten angelegt: 2 Pakete, 6 Video-Kacheln
stneuro-Server läuft auf http://127.0.0.1:3001
```

Bricht der Start mit „MariaDB nicht erreichbar" ab, stimmen die
`DB_*`-Variablen nicht oder MariaDB läuft nicht.

## 6. Apache-vHost

```bash
cp /opt/stneuro/deploy/apache.conf /etc/apache2/sites-available/stneuro.np-dev.de.conf
a2ensite stneuro.np-dev.de
a2enmod proxy proxy_http deflate
apachectl configtest && systemctl reload apache2
```

Die Subdomain muss im DNS auf den Server zeigen; Zertifikat wie bei den
übrigen vHosts (certbot bzw. bestehende Vorlage) ergänzen.

## 7. Abnahme

```bash
curl -I  https://stneuro.np-dev.de/                     # 200
curl -s  https://stneuro.np-dev.de/api/portal/videos    # JSON mit den öffentlichen Kacheln
curl -s  https://stneuro.np-dev.de/api/admin/health     # {"error":"Nicht angemeldet."}
curl -sI http://127.0.0.1:3001/ | head -1               # 200, nur lokal
```

Von außen darf Port 3001 **nicht** erreichbar sein:

```bash
curl --max-time 5 http://stneuro.np-dev.de:3001/   # muss scheitern
```

Dann im Browser unter `/admin` anmelden und **sofort das Admin-Passwort
ändern** (Verwaltung → Zugänge). Anschließend `ADMIN_PASSWORD` aus
`/etc/stneuro.env` entfernen und `systemctl restart stneuro` — sonst wird das
Passwort bei jedem Neustart wieder überschrieben.

---

## Aktualisieren

```bash
cd /opt/stneuro
sudo -u stneuro git pull
sudo -u stneuro npm ci
sudo -u stneuro npm run build
systemctl restart stneuro
```

Angemeldet bleiben die Nutzer über die Aktualisierung hinweg, weil die
Sitzungen in der Datenbank liegen.

Nach dem Neustart im Browser einmal hart neu laden (Strg+Umschalt+R). Der
Service Worker zieht sonst unter Umständen noch die alte Fassung aus dem
Zwischenspeicher.

## Sitzungen

Die laufenden Anmeldungen stehen in der Tabelle `sessions`, damit ein Deploy
niemanden abmeldet. Die Tabelle enthält gültige Sitzungskennungen und ist
damit so schützenswert wie die Passwort-Hashes.

Alle Anmeldungen auf einmal beenden:

```bash
systemctl stop stneuro
mariadb -u stneuro -p stneuro -e 'DELETE FROM sessions;'
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
# vom Arbeitsrechner
rsync -av --progress *.mp4 root@stneuro.np-dev.de:/var/lib/stneuro/videos/
ssh root@stneuro.np-dev.de 'chown stneuro:stneuro /var/lib/stneuro/videos/*'
```

Danach in der Verwaltung (**Videos → Bearbeiten → Videodatei**) die Datei mit
der Kachel verknüpfen — die Auswahl zeigt alles, was im Verzeichnis liegt,
mit ausgelesener Laufzeit. Kein Neustart nötig.

Empfohlenes Format: **MP4 (H.264/AAC)** — spielt in jedem Browser, lässt sich
per Range-Request anspulen, und die Laufzeit liest der Dienst selbst aus dem
Dateikopf (`moov/mvhd`, ohne ffmpeg). Bei WebM bleibt das Dauer-Feld leer und
wird von Hand eingetragen.

> **Apache und große Uploads:** `LimitRequestBody` ist per Vorgabe unbegrenzt.
> Steht in der Konfiguration ein Wert, begrenzt er auch den Video-Upload —
> dann entweder erhöhen oder für diesen Pfad aufheben:
>
> ```apache
> <Location /api/admin/upload>
>   LimitRequestBody 0
> </Location>
> ```
>
> Node bricht solche Anfragen nicht ab (`requestTimeout` ist im Dienst
> abgeschaltet); ein `ProxyTimeout` in Apache sollte großzügig stehen.

Ausgeliefert werden die Dateien ausschließlich über
`/api/portal/videos/:id/stream` nach Berechtigungsprüfung (Sitzung → Paket
bzw. Einzelfreischaltung). Es gibt **keinen** direkten Apache-Pfad auf das
Verzeichnis — den darf es auch nie geben, sonst wäre die Freischaltung
wirkungslos.

## Sicherung

Die **Datenbank** sichert `deploy/backup.sh` nach `/var/backups/stneuro/`
(Zugangsdaten liest es aus `/etc/stneuro.env`, alte Stände räumt es nach 14
Tagen selbst weg). Die **Videodateien** sind bewusst nicht dabei — 1 TB
täglich zu dumpen wäre Unsinn. Wenn die Originale nicht ohnehin anderswo
liegen, gehört das Verzeichnis in einen separaten rsync-Spiegel:

```bash
cp /opt/stneuro/deploy/backup.cron /etc/cron.d/stneuro-backup

# Einmal von Hand laufen lassen und das Ergebnis ansehen:
sh /opt/stneuro/deploy/backup.sh
ls -lh /var/backups/stneuro/
```

Zum Zurückspielen: Dienst stoppen,
`zcat db-<datum>.sql.gz | mariadb -u stneuro -p stneuro` einspielen, Dienst
starten.

## Wenn etwas nicht läuft

| Symptom | Ursache |
|---|---|
| `502 Bad Gateway` | Dienst läuft nicht — `journalctl -u stneuro -n 50` |
| Dienst startet nicht, Log: „MariaDB nicht erreichbar" | MariaDB läuft nicht oder `DB_*`-Variablen falsch |
| Anmeldung klappt, fliegt aber sofort wieder raus | `SECURE_COOKIES=1` ohne HTTPS |
| Nach Deploy alter Stand im Browser | Service Worker — einmal hart neu laden |
