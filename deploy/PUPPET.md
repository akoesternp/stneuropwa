# stneuro — Serverstand für Puppet

Was auf `NP-st-neuro` für stneuro (`shop.st-neuro.np-dev.de`) von Hand
eingerichtet wurde und künftig per Puppet kommen soll. Die ausführliche
Begründung der einzelnen Schritte steht in [README.md](README.md); diese
Datei ist die Checkliste zum Übertragen.

Die Vorlagen, auf die Puppet zeigen kann, liegen im Repository unter
`deploy/`: `apache.conf`, `stneuro.service`, `backup.sh`, `backup.cron`, dazu
`.env.example` im Wurzelverzeichnis.

> **Vor dem Schreiben der Manifeste den Ist-Zustand erfassen** (Abschnitt
> ganz unten). Einiges wurde während der Einrichtung entschieden und steht
> hier nur als Soll — etwa ob MariaDB oder MySQL läuft.

---

## Auf einen Blick

| Bereich | Was | Puppet-Baustein (Vorschlag) |
|---|---|---|
| Pakete | `sudo apache2 mariadb-server git certbot rsync curl ca-certificates` | `package` |
| Node | `nodejs` ≥ 20.19 (gerades Hauptband), `npm` | `package`, ggf. `apt::source` (NodeSource) |
| Benutzer | Systembenutzer `stneuro`, Home `/opt/stneuro`, keine Shell | `group`, `user` |
| Verzeichnisse | `/opt/stneuro`, `/var/lib/stneuro/{videos,vorschaubilder}`, `/var/www/letsencrypt`, `/var/backups/stneuro` | `file` |
| Deploy Key | `/opt/stneuro/.ssh/id_ed25519` + GitHub in `known_hosts` | `file` (Schlüssel aus Hiera eyaml), `sshkey` |
| Anwendung | `git clone` von `main` nach `/opt/stneuro/app`, `npm ci`, `npm run build` | `vcsrepo`, `exec` (refreshonly) |
| Datenbank | DB `stneuro`, Benutzer `stneuro`@`localhost` **und** @`127.0.0.1` | `puppetlabs-mysql`: `mysql::db`, `mysql_user`, `mysql_grant` |
| Konfiguration | `/etc/stneuro.env`, root, 0600 | `file` mit Template, Geheimnisse aus Hiera eyaml |
| Dienst | `/etc/systemd/system/stneuro.service`, enabled + running | `systemd::unit_file` (puppet-systemd) |
| Apache-Module | `ssl rewrite headers proxy proxy_http deflate alias` | `apache::mod::*` oder `exec a2enmod` |
| vHost | `/etc/apache2/sites-available/shop.st-neuro.np-dev.de.conf` + aktiviert | `file` + Symlink, siehe Warnung unten |
| Zertifikat | Let's Encrypt über Webroot, Reload-Haken | `puppet-letsencrypt`: `letsencrypt::certonly` |
| Sicherung | `/etc/cron.d/stneuro-backup`, täglich 2:45 | `file` |
| System | Zeitzone Europe/Berlin, Firewall 80/443 offen, 3001/3306 zu | `timezone`-Modul bzw. `file`, `firewall` |

**Nicht** gebraucht: ffmpeg, ein lokaler Mailserver, PHP (phpMyAdmin auf dem
Server gehört nicht zu stneuro — siehe unten).

---

## 1. Pakete

| Paket | Wofür | Anmerkung |
|---|---|---|
| `sudo` | `sudo -u stneuro` in Anleitung und Handgriffen | Fehlte auf dem minimalen Debian |
| `apache2` | Reverse Proxy, TLS | Lief schon für die andere Webseite |
| `mariadb-server` | Datenbank | **Entfällt, falls dort MySQL läuft** — nie beide |
| `git` | Anwendung holen | |
| `certbot` | Zertifikat | Nur das Grundpaket, kein `python3-certbot-apache` nötig |
| `rsync` | Videos hochladen | |
| `curl`, `ca-certificates` | NodeSource-Einrichtung, Prüfungen | |
| `nodejs`, `npm` | Dienst und Build | Siehe nächster Abschnitt |

### Node

`package.json` verlangt `node >= 20.19`; Node 21 geht **nicht** (Vite).

| Debian | Quelle |
|---|---|
| 13 (trixie) | Debian-Pakete `nodejs` und `npm` reichen (20.19) |
| 12 (bookworm) | NodeSource, Band 22 |

NodeSource als apt-Quelle statt `curl | bash`:

```
URL:     https://deb.nodesource.com/node_22.x
Release: nodistro
Repos:   main
Key:     https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key
```

Das Paket `nodejs` von NodeSource enthält npm bereits — dort **kein**
separates `npm` aus Debian installieren, die beiden beißen sich.

Der Dienst ruft `/usr/bin/node` auf. Wer Node anders installiert (nvm,
eigener Pfad), muss `ExecStart` in der Unit anpassen.

---

## 2. Benutzer und Verzeichnisse

```
Gruppe  stneuro      (system)
Benutzer stneuro     (system), Home /opt/stneuro, Shell /usr/sbin/nologin
```

| Pfad | Besitzer | Modus | Inhalt |
|---|---|---|---|
| `/opt/stneuro` | stneuro:stneuro | 0750 | Home: `.ssh`, `.npm` |
| `/opt/stneuro/.ssh` | stneuro:stneuro | 0700 | Deploy Key |
| `/opt/stneuro/app` | stneuro:stneuro | — | `git clone`, von `vcsrepo` angelegt |
| `/var/lib/stneuro` | stneuro:stneuro | 0750 | |
| `/var/lib/stneuro/videos` | stneuro:stneuro | 0755 | Videodateien, bis ~1 TB — eigenes Volume sinnvoll |
| `/var/lib/stneuro/vorschaubilder` | stneuro:stneuro | 0755 | |
| `/var/www/letsencrypt` | root:root | 0755 | Webroot für certbot |
| `/var/backups/stneuro` | root:root | 0700 | legt `backup.sh` selbst an |
| `/etc/stneuro.env` | root:root | 0600 | Konfiguration mit Geheimnissen |

Die Anwendung liegt **unter** dem Home, nicht darin: `git clone` verlangt ein
leeres Ziel, und im Home liegen `.ssh` und `.npm`.

Videos und Vorschaubilder **nie** unter `/opt/stneuro/app` — und Puppet darf
diese Verzeichnisse nicht mit `purge`/`recurse` verwalten: dort liegen
hochgeladene Dateien, die in keinem Manifest stehen.

---

## 3. Deploy Key und Anwendung

**Repository:** `git@github.com:akoesternp/stneuropwa.git`, Zweig `main`
(entwickelt wird auf `feat/videoportal`, `main` ist der Betriebsstand).

**Deploy Key:** ed25519, nur Lesen, bei GitHub unter *Settings → Deploy
keys* eingetragen. Auf dem Server heute von Hand erzeugt. Für Puppet:
privaten Schlüssel in Hiera eyaml ablegen und als Datei ausrollen — sonst
erzeugt jede Neuinstallation einen neuen Schlüssel, der erst bei GitHub
eingetragen werden muss.

**known_hosts:** GitHub ed25519, von GitHub veröffentlicht:

```
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
Fingerabdruck SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU
```

**Build** — als Benutzer `stneuro`, mit `HOME=/opt/stneuro`, im
Verzeichnis `/opt/stneuro/app`:

```bash
npm ci
npm run build          # Typprüfung, dist/, server-dist/
```

Braucht kurzzeitig ~2 GB RAM (`vue-tsc`) und ein paar Minuten — im `exec`
ein großzügiges `timeout` setzen. Bei wenig RAM
`NODE_OPTIONS=--max-old-space-size=2048` in die Umgebung.

`npm ci` warnt über ein veraltetes `glob` (kommt über `vite-plugin-pwa`,
nur beim Bauen) — das ist kein Fehler.

> **Entscheidung für Puppet:** Soll Puppet auch **ausrollen** (`vcsrepo`
> mit `ensure => latest` → bei jedem Lauf neuer Stand von `main`, Build,
> Neustart) oder nur die **Umgebung** bereitstellen und das Aktualisieren
> bleibt ein bewusster Handgriff? Automatisch heißt: jeder Push auf `main`
> geht beim nächsten Puppet-Lauf live — samt etwaiger Datenbank-Migration
> beim Start (siehe Abschnitt 5).

---

## 4. Datenbank

MariaDB (oder vorhandenes MySQL ≥ 8.0), nur auf `127.0.0.1:3306`
(`bind-address = 127.0.0.1`, Debian-Vorgabe).

root meldet sich über den Unix-Socket an, **ohne Passwort** — so lassen.
Anonyme Benutzer, Test-DB und root-Fernzugriff entfernt
(`mariadb-secure-installation`).

```sql
CREATE DATABASE stneuro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'stneuro'@'localhost' IDENTIFIED BY '…';
CREATE USER 'stneuro'@'127.0.0.1' IDENTIFIED BY '…';     -- dasselbe Passwort
GRANT ALL PRIVILEGES ON stneuro.* TO 'stneuro'@'localhost';
GRANT ALL PRIVILEGES ON stneuro.* TO 'stneuro'@'127.0.0.1';
```

**Beide Hosts sind nötig:** Dienst und Sicherung verbinden sich per TCP über
`127.0.0.1`, der Kommandozeilen-Client über den Socket als `localhost`. Mit
nur einem Eintrag kommt je nach Weg „Access denied" trotz richtigem Passwort.

Die Tabellen legt der Dienst beim Start selbst an — kein Schema-Import in
Puppet.

**phpMyAdmin** ist auf dem Server vorhanden, gehört aber nicht zu stneuro.
Falls es bleibt: eigener Admin-Benutzer statt root (root hat kein Passwort),
und Zugriff per `Require ip` einschränken oder die Konfiguration abschalten.

---

## 5. Konfiguration `/etc/stneuro.env`

root:root, 0600. systemd liest die Datei vor dem Benutzerwechsel. Format:
`SCHLÜSSEL=wert`, keine Leerzeichen ums `=`, keine Anführungszeichen nötig.

| Variable | Wert auf NP-st-neuro | Geheim | Anmerkung |
|---|---|---|---|
| `PORT` | `3001` | | muss zu `ProxyPass` im vHost passen |
| `HOST` | `127.0.0.1` | | **nie** 0.0.0.0 — sonst an Apache vorbei erreichbar |
| `SECURE_COOKIES` | `0` → später `1` | | `0` nur solange es kein Zertifikat gibt |
| `VIDEO_DIR` | `/var/lib/stneuro/videos` | | |
| `THUMB_DIR` | `/var/lib/stneuro/vorschaubilder` | | |
| `DB_HOST` | `127.0.0.1` | | |
| `DB_PORT` | `3306` | | |
| `DB_NAME` | `stneuro` | | |
| `DB_USER` | `stneuro` | | |
| `DB_PASSWORD` | — | **ja** | identisch mit dem DB-Benutzer |
| `ADMIN_USER` | `admin` | | |
| `ADMIN_PASSWORD` | **nicht dauerhaft setzen** | ja | setzt das Backend-Passwort bei **jedem** Start zurück; nur als Notausgang |
| `REGISTRIERUNG` | `1` | | `0` schaltet Selbstregistrierung ab |
| `START_CREDITS` | leer (0) | | |
| `KONTAKT_EMAIL` | offen | | |
| `BESTELLUNG_VERFALL_TAGE` | leer (14) | | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` | offen | | Postfach beim Mailanbieter, kein lokaler MTA |
| `SMTP_PASSWORT` | offen | **ja** | |
| `MAIL_ABSENDER`, `MAIL_BETREIBER` | offen | | Absender muss per SPF/DKIM zum Postfach passen |
| `VORKASSE_EMPFAENGER`, `_IBAN`, `_BIC`, `_BANK`, `_DAUER` | offen | | ohne IBAN ist Überweisung aus |
| `PAYPAL_ENV` | offen | | ohne Angabe `sandbox`; Betrieb `live` |
| `PAYPAL_CLIENT_ID` | offen | | |
| `PAYPAL_SECRET` | offen | **ja** | Live-Daten, nicht die der Sandbox |

Werte mit Leerzeichen (etwa `VORKASSE_EMPFAENGER`) sind für systemd in
Ordnung. `deploy/backup.sh` liest nur die `DB_*`-Zeilen und kommt damit
ebenfalls zurecht.

Eine Änderung an der Datei braucht einen Neustart des Dienstes → im Manifest
`notify => Service['stneuro']`.

> **Migration beim Start:** Der Dienst passt beim Hochfahren das Schema an
> (zuletzt: `benutzer_pakete` wird in `benutzer_videos` überführt und
> gelöscht). Vor einem Update, das Puppet ausrollt, sollte deshalb eine
> Sicherung laufen — bei automatischem Ausrollen ein `exec` mit
> `backup.sh` vor dem Build einplanen.

---

## 6. systemd

Quelle: `deploy/stneuro.service` → `/etc/systemd/system/stneuro.service`,
`enable` + `start`. Die Unit setzt:

```
User/Group         stneuro
WorkingDirectory   /opt/stneuro/app
EnvironmentFile    /etc/stneuro.env
ExecStart          /usr/bin/node server-dist/server/index.js
Restart            always (5 s), StartLimit 5 in 60 s  (unter [Unit])
ProtectSystem      strict, ReadWritePaths=/var/lib/stneuro
```

Ausgehend braucht der Dienst HTTPS zu PayPal (`api-m.paypal.com`) und SMTP
zum Postfach — eine Egress-Firewall muss beides durchlassen.

Reihenfolge: Unit erst starten, wenn Build, `/etc/stneuro.env` und die
Datenbank da sind; nach jedem Build `notify` auf den Dienst.

---

## 7. Apache

### Module

```
ssl rewrite headers proxy proxy_http deflate alias
```

Neue Module brauchen einen **Neustart**, keinen Reload.

### vHost

Quelle: `deploy/apache.conf` →
`/etc/apache2/sites-available/shop.st-neuro.np-dev.de.conf`, aktiviert per
Symlink in `sites-enabled` (entspricht `a2ensite`).

Die Datei enthält beide vHosts (:80 und :443) und schaltet selbst um,
abhängig davon, ob `/etc/letsencrypt/live/shop.st-neuro.np-dev.de/fullchain.pem`
existiert (`<IfFile>`):

- **ohne Zertifikat:** Port 80 liefert das Portal aus (Übergang), der
  Prüfpfad `/.well-known/acme-challenge/` zeigt auf `/var/www/letsencrypt`
- **mit Zertifikat:** Port 80 leitet auf HTTPS um, der :443-vHost ist aktiv

Deshalb scheitert `apachectl configtest` nicht, bevor certbot gelaufen ist,
und Puppet muss nichts umschalten — nach dem Zertifikat genügt ein Reload.

`<IfFile>` lässt sich im `apache::vhost`-Typ von puppetlabs-apache **nicht**
abbilden. Einfacher: die Datei als `source`/`content` ausrollen.

> **Warnung — bestehende Webseite:** `puppetlabs-apache` löscht mit den
> Vorgaben (`purge_configs => true`, `default_vhost => true`) alle
> Apache-Konfigurationen, die nicht aus Puppet kommen — also auch die der
> anderen Webseite auf diesem Server. Entweder die andere Seite ebenfalls
> in Puppet übernehmen oder `purge_configs => false` und
> `default_vhost => false` setzen. Nach dem ersten Lauf mit `apache2ctl -S`
> prüfen, dass die andere Seite weiter Standard-vHost ist.

---

## 8. Zertifikat

**Stand: noch nicht eingerichtet** — HTTPS ist auf dem Server vorerst nicht
möglich, das Portal läuft über http mit `SECURE_COOKIES=0`.

Soll:

```bash
certbot certonly --webroot -w /var/www/letsencrypt -d shop.st-neuro.np-dev.de \
  --deploy-hook "systemctl reload apache2"
```

- Verlängerung über den systemd-Timer aus dem certbot-Paket
  (`certbot.timer`) — kein zusätzlicher Cron nötig
- Der **Deploy-Hook ist Pflicht**: mit `--webroot` lädt certbot Apache nicht
  selbst neu, sonst liefert Apache nach 90 Tagen ein abgelaufenes Zertifikat
- Voraussetzung: DNS A (und ggf. AAAA) auf den Server, Port 80 von außen
  offen

Danach: `SECURE_COOKIES=1` in `/etc/stneuro.env`, Dienst neu starten,
Apache neu laden.

---

## 9. Sicherung

Quelle: `deploy/backup.cron` → `/etc/cron.d/stneuro-backup`:

```
45 2 * * * root /bin/sh /opt/stneuro/app/deploy/backup.sh
```

- Dump der Datenbank nach `/var/backups/stneuro/db-JJJJ-MM-TT.sql.gz`, 14 Tage
- nimmt `mariadb-dump` oder `mysqldump`, je nachdem, was installiert ist
- **nicht** gesichert: Videos (~1 TB) und Vorschaubilder — Videos gehören in
  eine eigene Sicherung/rsync-Spiegelung
- `/var/backups/stneuro` liegt auf demselben Server → zusätzlich nach
  außen sichern

Uhrzeit mit einer etwaigen Sicherung der anderen Webseite abstimmen.

---

## 10. System

| | Soll |
|---|---|
| Zeitzone | `Europe/Berlin` |
| Firewall eingehend | 22, 80, 443 offen — **3001 und 3306 zu** |
| DNS | `shop.st-neuro.np-dev.de` → Server (A, ggf. AAAA) — außerhalb von Puppet |

---

## Was Puppet nicht übernehmen kann

- DNS-Eintrag
- Deploy Key bei GitHub eintragen (einmalig; entfällt bei festem Schlüssel aus eyaml)
- Backend-Passwort im Portal ändern (liegt in der Datenbank)
- PayPal-Live-Zugang, SMTP-Postfach, Kontaktadresse beschaffen
- Pflichttexte (Impressum, Datenschutz, Widerrufsbelehrung) — im Code

---

## Abhängigkeiten (Reihenfolge)

```
Pakete, Node ──► Benutzer/Verzeichnisse ──► Deploy Key + known_hosts ──► vcsrepo
                                                                          │
MariaDB ──► DB + Benutzer ─────────────────┐                              ▼
                                           ├──► /etc/stneuro.env ──► exec Build
                                           │                              │
                                           └──────────────────────────► Service stneuro
Apache-Module ──► vHost ──► Reload ──► certbot ──► Reload
                                         └──► SECURE_COOKIES=1 ──► Neustart stneuro
```

---

## Skizze

**Ungetestet** — Parameternamen je Modulversion prüfen. Gedacht als
Ausgangspunkt, nicht zum Einchecken.

```puppet
class profile::stneuro (
  Sensitive[String] $db_password,
  Sensitive[String] $deploy_key,
  String            $domain          = 'shop.st-neuro.np-dev.de',
  Boolean           $secure_cookies  = false,
  Hash              $env_extra       = {},    # SMTP_*, PAYPAL_*, VORKASSE_* …
) {
  $home = '/opt/stneuro'
  $app  = "${home}/app"

  package { ['sudo', 'git', 'certbot', 'rsync', 'curl', 'ca-certificates', 'nodejs']:
    ensure => installed,
  }

  group { 'stneuro': ensure => present, system => true }
  user { 'stneuro':
    ensure => present, system => true, gid => 'stneuro',
    home => $home, shell => '/usr/sbin/nologin', managehome => false,
  }

  file { [$home, '/var/lib/stneuro']:
    ensure => directory, owner => 'stneuro', group => 'stneuro', mode => '0750',
  }
  file { ['/var/lib/stneuro/videos', '/var/lib/stneuro/vorschaubilder']:
    ensure => directory, owner => 'stneuro', group => 'stneuro', mode => '0755',
  }
  file { "${home}/.ssh":
    ensure => directory, owner => 'stneuro', group => 'stneuro', mode => '0700',
  }
  file { "${home}/.ssh/id_ed25519":
    ensure => file, owner => 'stneuro', group => 'stneuro', mode => '0600',
    content => $deploy_key,
  }
  sshkey { 'github.com':
    ensure => present, type => 'ssh-ed25519',
    key    => 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  }

  vcsrepo { $app:
    ensure   => present,            # latest = automatisch ausrollen, siehe Abschnitt 3
    provider => git,
    source   => 'git@github.com:akoesternp/stneuropwa.git',
    revision => 'main',
    user     => 'stneuro',
    identity => "${home}/.ssh/id_ed25519",
    require  => [File["${home}/.ssh/id_ed25519"], Sshkey['github.com']],
  }

  exec { 'stneuro-build':
    command     => 'npm ci && npm run build',
    cwd         => $app,
    user        => 'stneuro',
    environment => ["HOME=${home}"],
    path        => ['/usr/bin', '/bin'],
    provider    => shell,
    timeout     => 1800,
    refreshonly => true,
    subscribe   => Vcsrepo[$app],
    notify      => Service['stneuro'],
  }

  mysql::db { 'stneuro':
    user     => 'stneuro',
    password => $db_password,
    host     => 'localhost',
    charset  => 'utf8mb4',
    collate  => 'utf8mb4_unicode_ci',
    grant    => ['ALL'],
  }
  mysql_user { 'stneuro@127.0.0.1':
    ensure        => present,
    password_hash => mysql::password($db_password),
  }
  mysql_grant { 'stneuro@127.0.0.1/stneuro.*':
    user => 'stneuro@127.0.0.1', table => 'stneuro.*', privileges => ['ALL'],
  }

  file { '/etc/stneuro.env':
    ensure  => file, owner => 'root', group => 'root', mode => '0600',
    content => Sensitive(epp('profile/stneuro/stneuro.env.epp', {
      'db_password'    => $db_password,
      'secure_cookies' => $secure_cookies,
      'extra'          => $env_extra,
    })),
    notify  => Service['stneuro'],
  }

  systemd::unit_file { 'stneuro.service':
    source  => "file://${app}/deploy/stneuro.service",
    enable  => true,
    active  => true,
    require => [Exec['stneuro-build'], File['/etc/stneuro.env'], Mysql::Db['stneuro']],
  }

  # Apache: puppetlabs-apache nur mit purge_configs => false, siehe Abschnitt 7.
  file { "/etc/apache2/sites-available/${domain}.conf":
    ensure => file, source => "file://${app}/deploy/apache.conf",
    notify => Service['apache2'],
  }
  file { "/etc/apache2/sites-enabled/${domain}.conf":
    ensure => link, target => "../sites-available/${domain}.conf",
    notify => Service['apache2'],
  }
  file { '/var/www/letsencrypt': ensure => directory, mode => '0755' }

  letsencrypt::certonly { $domain:
    plugin               => 'webroot',
    webroot_paths        => ['/var/www/letsencrypt'],
    deploy_hook_commands => ['systemctl reload apache2'],
    require              => File["/etc/apache2/sites-enabled/${domain}.conf"],
  }

  file { '/etc/cron.d/stneuro-backup':
    ensure => file, mode => '0644', source => "file://${app}/deploy/backup.cron",
  }
}
```

---

## Ist-Zustand erfassen

Auf `NP-st-neuro` als root, bevor die Manifeste geschrieben werden:

```bash
cat /etc/debian_version
mysql --version                                   # MariaDB oder MySQL?
node -v; which node; apt-cache policy nodejs      # Debian oder NodeSource?
ls /etc/apt/sources.list.d/
dpkg -l | grep -E 'apache2|mariadb|mysql|nodejs|certbot|phpmyadmin'
apache2ctl -M | sort                              # geladene Module
apache2ctl -S                                     # vHosts, Standard je Port
ls -l /etc/apache2/sites-enabled/
id stneuro; ls -la /opt/stneuro /var/lib/stneuro
systemctl is-enabled stneuro; systemctl is-active stneuro
diff /opt/stneuro/app/deploy/stneuro.service /etc/systemd/system/stneuro.service
diff /opt/stneuro/app/deploy/apache.conf /etc/apache2/sites-available/shop.st-neuro.np-dev.de.conf
grep -o '^[A-Z_]*' /etc/stneuro.env               # nur die Schlüssel, keine Werte
ls /etc/cron.d/; ls /etc/letsencrypt/live/ 2>/dev/null
mariadb -e "SELECT user, host FROM mysql.user WHERE user = 'stneuro'"
timedatectl | grep 'Time zone'; ufw status 2>/dev/null
```

Weicht eine der Kopien in `/etc` von der Vorlage im Repository ab, wurde sie
auf dem Server von Hand geändert — das vor dem Umstieg auf Puppet klären,
sonst überschreibt der erste Lauf die Änderung.
