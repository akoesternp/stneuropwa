# stneuro — Videoportal (PWA)

Videoportal mit Paketen. Besucher sehen die öffentlichen Videos und die
komplette **Paketübersicht** (Titel und Laufzeiten — als Beschreibung des
Angebots); angemeldete Nutzer zusätzlich die Videos ihrer zugewiesenen
Pakete sowie einzeln freigeschaltete. Die Verwaltung unter `/admin` pflegt
Nutzer, Pakete, Videos und Backend-Zugänge.

Ein Video kann in **mehreren Paketen** liegen; ohne Paket ist es öffentlich.
Videodateien lassen sich im Backend hochladen oder per SFTP ablegen — die
Laufzeit liest der Server aus dem Dateikopf. Ausgeliefert werden sie
ausschließlich über `/api/portal/videos/:id/stream` nach Berechtigungsprüfung
am Sitzungscookie (Range-Requests, also kein Vollabruf großer Dateien).

Technisch baugleich mit dem Händlerportal (fritzgoebelpwa): Vue 3 + Vite +
Pinia + vue-router + vite-plugin-pwa im Frontend, Express + TypeScript als
Server, MariaDB ohne ORM. Konfiguration ausschließlich über
Umgebungsvariablen (`.env.example`), Sitzungen als httpOnly-Cookies mit
Tabelle in MariaDB, Schema legt der Server beim Start selbst an.

## Struktur

```
src/          Frontend (Vue 3)
server/       API (Express), Routen unter /api/*
shared/       gemeinsame Typen
tools/        CLI-Werkzeuge (z. B. Nutzer anlegen)
deploy/       Anleitung, Apache-vHost, systemd-Unit, backup.sh
```

## Lokale Entwicklung (Windows / PowerShell)

MariaDB läuft in Docker Desktop im vorhandenen Container
`haendlerportal-mariadb`; stneuro nutzt darin eine eigene Datenbank:

```powershell
docker exec haendlerportal-mariadb mariadb -uroot -phaendlerportal-root -e @'
CREATE DATABASE IF NOT EXISTS stneuro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'stneuro'@'%' IDENTIFIED BY 'stneuro';
GRANT ALL PRIVILEGES ON stneuro.* TO 'stneuro'@'%';
FLUSH PRIVILEGES;
'@
```

Dann in zwei Terminals:

```powershell
npm install
npm run dev:server   # API auf http://localhost:3001 (legt Schema + Beispieldaten an)
npm run dev          # Vite auf http://localhost:5173, /api wird zu 3001 durchgereicht
```

Erster Backend-Zugang: `admin` / `stneuro-admin` (steht auch im Serverlog).
Anmeldung unter http://localhost:5173/admin — dort das Passwort ändern und
den ersten Portal-Nutzer anlegen.

Einen Nutzer gibt es auch per CLI:

```powershell
npm run benutzer:anlegen -- max@example.de geheimes-passwort "Max Muster"
```

## Bauen und Betrieb

```powershell
npm run build    # Typprüfung, dist/ (Frontend) und server-dist/ (Server)
npm start        # liefert dist/ aus und bedient /api — Port über $env:PORT
```

Deployment auf dem Debian-Server (eigene Subdomain, eigener Apache-vHost,
systemd-Dienst, Port 3001, git-Deploy über Deploy Key): siehe
[deploy/README.md](deploy/README.md).
