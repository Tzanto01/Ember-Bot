# Datenschutzerklärung für Ember

> **English summary (not binding; the German text below is the binding version).**
> Ember is a free Discord habit tracker run by a private individual in Germany. It stores only what it needs to work: your Discord user ID, your timezone, your habits (name, schedule, reminder time, pause), your check-in log (date, done or not, and the server where you checked in), your grace days, your leaderboard choice (off by default) and whether reminder DMs reach you. Habit names and check-ins can reveal health information, so Ember processes them only with your explicit consent (GDPR Art. 9(2)(a)). Ember cannot read your messages, sells nothing, shows no ads, runs no tracking and uses no AI. Discord (USA) carries every message as the platform. You can download everything with `/export` and delete everything at once with `/privacy delete`. Data stays until you delete it; backups roll over after a fixed period.

---

**Stand:** [DATUM]

Ember ist ein kostenloser Habit Tracker für Discord. Diese Erklärung sagt dir, welche Daten Ember verarbeitet, warum, wie lange, und welche Rechte du hast. Wir haben sie so kurz und klar wie möglich gehalten.

## 1. Wer ist verantwortlich?

Verantwortlich im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:

[NAME]
[ANSCHRIFT: Straße und Hausnummer]
[ANSCHRIFT: PLZ und Ort]
Deutschland

E-Mail: [E-MAIL]

Ember wird privat und nicht kommerziell betrieben. Einen Datenschutzbeauftragten gibt es nicht, weil keine gesetzliche Pflicht dazu besteht. Bei allen Fragen zum Datenschutz schreib einfach an die oben genannte E-Mail-Adresse.

## 2. Das Wichtigste in Kürze

- Ember speichert nur, was es braucht, damit deine Habits, Streaks und Erinnerungen funktionieren.
- Ember kann deine Nachrichten nicht lesen. Der Bot verbindet sich ohne Gateway Intents mit Discord (`GatewayIntents.None`), bekommt also weder Nachrichteninhalte noch Mitgliederlisten noch Online-Status. Er sieht nur, was du ihm über seine Befehle, Menüs und Buttons selbst schickst.
- Keine Werbung, kein Tracking, keine Analyse-Tools, kein Verkauf von Daten, keine KI.
- Du kannst jederzeit alle deine Daten herunterladen (`/export`) und alles auf einmal löschen (`/privacy delete`).

## 3. Welche Daten verarbeitet Ember?

### 3.1 Daten, die Ember speichert

| Daten | Wofür |
|---|---|
| Deine Discord-Nutzer-ID | Damit Ember deine Habits dir zuordnen und dir Erinnerungen per Direktnachricht (DM) schicken kann. |
| Deine Zeitzone (zum Beispiel `Europe/Berlin`) | Damit „heute“, Streaks, Wochenübersichten und Erinnerungen nach deiner eigenen Uhrzeit laufen. Solange du keine Zeitzone wählst, gilt UTC. |
| Deine Habits: Name, Häufigkeit (täglich oder x-mal pro Woche), Erinnerungszeit, Pause bis zu einem Datum, Erstellungszeitpunkt | Damit Ember deine Habits anzeigen, auswerten und an sie erinnern kann. Den Namen wählst du selbst (höchstens 100 Zeichen). |
| Der nächste geplante Erinnerungszeitpunkt pro Habit (in UTC) | Damit Erinnerungen pünktlich kommen, auch über Sommer- und Winterzeit hinweg. |
| Deine Check-ins: Datum (ohne Uhrzeit), erledigt oder nicht erledigt, und die ID des Discord-Servers, auf dem du eingecheckt hast (leer bei Check-ins per DM) | Damit Ember Streaks, Wochen- und Monatsstatistiken berechnen kann. Die Server-ID wird nur für die Bestenliste dieses Servers gebraucht. |
| Deine Gnadentage pro Woche (0 bis 3) | Damit ein verpasster Tag deinen Streak nicht sofort beendet. |
| Deine Wahl zur Bestenliste (Standard: aus) | Damit du nur dann auf einer Bestenliste erscheinst, wenn du das ausdrücklich willst. |
| Zustellstatus deiner Erinnerungs-DMs: Zahl der fehlgeschlagenen Zustellungen in Folge und, falls nötig, der Zeitpunkt, ab dem Erinnerungen pausiert sind | Wenn Discord eine DM mehrmals hintereinander nicht zustellen kann (zum Beispiel weil du DMs von Servermitgliedern ausgeschaltet hast), pausiert Ember deine Erinnerungs-DMs und sagt dir das beim nächsten Mal Bescheid, statt es endlos weiter zu versuchen. |

Ember legt einen Eintrag für dich erst an, wenn du eine Funktion nutzt, die etwas speichern muss, zum Beispiel ein Habit anlegst, deine Zeitzone setzt oder deine Wahl zur Bestenliste änderst.

### 3.2 Daten, die Ember nur kurz verwendet und nicht speichert

- **Dein Discord-Nutzername**, wenn du mit `/habit share` eine Streak-Karte in einem Kanal postest. Der Name steht dann auf der Karte.
- **Der Anzeigename von Servermitgliedern**, die sich für die Bestenliste angemeldet haben. Ember fragt ihn bei Discord ab, wenn jemand `/leaderboard` aufruft, und schreibt ihn in die Bestenliste. Gespeichert wird er nicht.
- **Technische Angaben zu jeder Interaktion**, die Discord mitschickt (zum Beispiel aus welchem Server oder Kanal ein Befehl kommt). Ember nutzt sie nur, um den Befehl zu beantworten. Gespeichert wird davon nur die Server-ID bei einem Check-in (siehe oben).

### 3.3 Technische Protokolle (Logs)

Der Bot schreibt beim Betrieb technische Protokolle, zum Beispiel wenn eine Erinnerung verschickt wird oder ein Fehler auftritt. Darin können deine Discord-Nutzer-ID, die interne Nummer eines Habits, Zeitpunkte und Fehlermeldungen stehen. Habit-Namen gehören nicht in die Protokolle. Die Protokolle dienen nur dazu, Fehler zu finden und den Betrieb sicher zu halten. Sie werden nach 30 Tagen gelöscht.

### 3.4 Was Ember nicht verarbeitet

- keine Nachrichteninhalte, keine Sprach- oder Videodaten
- keine E-Mail-Adresse, kein Passwort, keine Telefonnummer
- keine Mitgliederlisten, keinen Online-Status, keine Freundeslisten
- keine Standortdaten (die Zeitzone wählst du selbst aus einer Liste)
- keine Cookies oder ähnliche Technik auf deinem Gerät, denn Ember läuft komplett innerhalb von Discord

## 4. Gesundheitsdaten

Viele Habits haben mit Gesundheit zu tun, zum Beispiel „Medikamente nehmen“, „Schlafen“ oder „Sport“. Ember bietet einige davon sogar als Vorlage an. Aus einem Habit-Namen und deinen Check-ins kann man deshalb unter Umständen etwas über deine Gesundheit ablesen. Solche Daten sind nach Art. 9 DSGVO besonders geschützt.

Wir behandeln deshalb **alle** Habit-Namen und Check-ins so, als könnten sie Gesundheitsdaten sein, egal worum es im einzelnen Habit geht. Ember verarbeitet sie nur mit deiner **ausdrücklichen Einwilligung** (Art. 9 Abs. 2 lit. a DSGVO). Du gibst sie, bevor du dein erstes Habit anlegst.

Du kannst deine Einwilligung jederzeit widerrufen (Art. 7 Abs. 3 DSGVO). Am einfachsten geht das mit `/privacy delete`: Dann löscht Ember sofort alle deine Daten. Ohne Habit-Namen und Check-ins kann Ember seinen Dienst nicht erbringen, deshalb ist das Löschen der Weg, die Einwilligung zu widerrufen. Was bis zum Widerruf passiert ist, bleibt rechtmäßig.

## 5. Zwecke und Rechtsgrundlagen

| Zweck | Rechtsgrundlage |
|---|---|
| Ember bereitstellen: Habits anlegen, Check-ins speichern, Streaks und Statistiken berechnen, Erinnerungen, Wochenübersicht und Rückblick per DM schicken, Export und Löschung | Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag, siehe Nutzungsbedingungen). Für Habit-Namen und Check-ins zusätzlich deine ausdrückliche Einwilligung nach Art. 9 Abs. 2 lit. a DSGVO (siehe Abschnitt 4). |
| Bestenliste in einem Server (nur wenn du dich anmeldest) | Art. 6 Abs. 1 lit. a DSGVO (Einwilligung). Du kannst sie jederzeit mit `/privacy optout` widerrufen. |
| Zustellstatus der Erinnerungs-DMs | Art. 6 Abs. 1 lit. b DSGVO, weil zuverlässige Erinnerungen Teil des Dienstes sind. |
| Technische Protokolle, Fehlersuche, Sicherheit, Backups | Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist ein sicherer, stabiler Betrieb und dass deine Daten nach einem technischen Ausfall nicht verloren sind. |

Es gibt keine automatisierte Entscheidungsfindung und kein Profiling im Sinne von Art. 22 DSGVO. Streaks und Statistiken sind einfache Rechnungen nur für dich und haben keine rechtliche oder ähnlich erhebliche Wirkung.

## 6. Wer bekommt deine Daten?

### 6.1 Discord

Ember läuft auf der Plattform Discord. Alles, was du mit Ember machst, und alles, was Ember dir schickt (Antworten, Erinnerungen, Wochenübersichten, Exporte), läuft über die Server von Discord. Discord ist dabei kein Auftragsverarbeiter von Ember, sondern verarbeitet die Daten als eigener Verantwortlicher nach seinen eigenen Regeln. Mit Discord hast du einen eigenen Vertrag.

- Anbieter: Discord Inc., USA [ZU PRÜFEN: ob Discord für Nutzer im EWR eine EU-Gesellschaft als Verantwortliche nennt]
- Datenschutzerklärung von Discord: https://discord.com/privacy
- Drittlandübermittlung: Discord verarbeitet Daten auch in den USA. Auf welcher Grundlage das geschieht, beschreibt Discord in seiner Datenschutzerklärung [ZU PRÜFEN: zum Beispiel EU-US Data Privacy Framework oder Standardvertragsklauseln].

Die Verbindung zwischen Ember und Discord ist verschlüsselt (TLS).

**Bitte beachte:** Nachrichten, die Ember dir per DM geschickt hat, Streak-Karten, die du mit `/habit share` gepostet hast, und Bestenlisten, die in einem Kanal stehen, liegen bei Discord. Ember kann sie nach dem Versenden nicht mehr zurückholen, auch nicht mit `/privacy delete`. Streak-Karten und Bestenlisten in einem Server können die Moderatoren des Servers löschen.

### 6.2 Hosting

Ember läuft derzeit auf einem privat betriebenen Server in Deutschland, den der Verantwortliche selbst betreibt. Dabei gibt es keinen externen Dienstleister, der Zugriff auf deine Daten hat.

[SPÄTER, NACH DEM UMZUG: Ember läuft auf einem gemieteten Server (VPS) bei [VPS-ANBIETER, Sitz], Rechenzentrum in [LAND IN DER EU]. Der Anbieter verarbeitet die Daten als Auftragsverarbeiter nach Art. 28 DSGVO auf Grundlage eines Vertrags zur Auftragsverarbeitung.]

### 6.3 Sonst niemand

Wir geben deine Daten an niemanden sonst weiter, verkaufen sie nicht und nutzen sie nicht für Werbung. Ember setzt keine Analyse-, Tracking- oder KI-Dienste ein. Eine Weitergabe an Behörden erfolgt nur, wenn wir gesetzlich dazu verpflichtet sind.

## 7. Wie lange speichert Ember deine Daten?

- **Deine Daten in Ember** bleiben gespeichert, bis du sie löschst. Mit `/habit delete` löschst du ein einzelnes Habit samt all seinen Check-ins. Mit `/privacy delete` löschst du sofort alles: deinen Eintrag, alle Habits, alle Check-ins, Erinnerungen und Einstellungen.
- **Backups:** Zum Schutz vor Datenverlust gibt es Sicherungskopien der Datenbank. Sie werden täglich erstellt und nach 30 Tagen überschrieben. Gelöschte Daten können bis dahin noch in einem Backup stehen und verschwinden dann endgültig. Backups werden nur genutzt, um nach einem technischen Ausfall den Betrieb wiederherzustellen.
- **Technische Protokolle:** 30 Tage (siehe Abschnitt 3.3).
- **Daten bei Discord:** Wie lange Discord Nachrichten speichert, richtet sich nach den Regeln von Discord.

## 8. Wie schützt Ember deine Daten?

- **Datensparsamkeit:** Ember speichert nur die oben genannten Daten. Bei Check-ins gibt es nur das Datum, keine Uhrzeit.
- **Kein Mitlesen:** Der Bot nutzt keine Gateway Intents und kann deshalb keine Nachrichteninhalte lesen.
- **Privat als Standard:** Antworten auf deine Befehle sieht in der Regel nur du. Öffentlich wird nur, was du selbst teilst (`/habit share`) oder wofür du dich angemeldet hast (Bestenliste).
- **Verschlüsselte Übertragung:** Die Verbindung zu Discord ist per TLS verschlüsselt.
- **Löschen auf Knopfdruck:** `/privacy delete` entfernt alles sofort.
- **Zugriff:** Nur der Verantwortliche hat Zugriff auf den Server und die Datenbank.

## 9. Deine Rechte

Du hast nach der DSGVO diese Rechte:

- **Auskunft** (Art. 15): welche Daten wir über dich haben.
- **Berichtigung** (Art. 16): falsche Daten korrigieren lassen.
- **Löschung** (Art. 17): deine Daten löschen lassen.
- **Einschränkung der Verarbeitung** (Art. 18).
- **Datenübertragbarkeit** (Art. 20): deine Daten in einem gängigen, maschinenlesbaren Format bekommen.
- **Widerspruch** (Art. 21) gegen Verarbeitungen auf Grundlage berechtigter Interessen (Abschnitt 5, letzte Zeile).
- **Widerruf von Einwilligungen** (Art. 7 Abs. 3), jederzeit und mit Wirkung für die Zukunft.

Die meisten Rechte kannst du direkt in Discord selbst ausüben:

| Was du willst | So geht es |
|---|---|
| Alle deine Daten sehen oder mitnehmen | `/export` aufrufen. Du bekommst eine Datei (CSV oder JSON) mit deinen Einstellungen, allen Habits (auch denen ohne Check-ins) und allen Check-ins mit Datum und Server-ID. Ember schickt sie dir per DM oder, wenn DMs nicht gehen, direkt als Antwort, die nur du siehst. |
| Alles löschen | `/privacy delete` aufrufen und bestätigen. Ember löscht sofort deinen Eintrag und alles, was daran hängt. Das lässt sich nicht rückgängig machen. Exportiere vorher, wenn du deine Daten behalten möchtest. |
| Ein Habit löschen | `/habit delete` |
| Einen Habit-Namen oder eine Erinnerung ändern | `/habit edit` |
| Bestenliste verlassen oder beitreten | `/privacy optout` oder `/privacy optin` |
| Gesundheitsdaten-Einwilligung widerrufen | `/privacy delete` (siehe Abschnitt 4) |

Für alles andere, oder wenn ein Befehl nicht funktioniert, schreib an [E-MAIL]. Wir antworten so schnell wie möglich, spätestens innerhalb eines Monats. Damit wir sicher sind, dass die Anfrage wirklich von dir kommt, fragen wir eventuell nach deiner Discord-Nutzer-ID und bitten dich, dich über Discord zu bestätigen.

### Beschwerderecht

Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), zum Beispiel in dem Land, in dem du wohnst. Für uns zuständig ist:

[NAME DER AUFSICHTSBEHÖRDE DES BUNDESLANDS]
[ANSCHRIFT DER AUFSICHTSBEHÖRDE]
[WEBSITE DER AUFSICHTSBEHÖRDE]

Wir freuen uns aber, wenn du uns zuerst schreibst. Oft lässt sich etwas schnell klären.

## 10. Mindestalter

Ember richtet sich an Menschen, die Discord nach dessen Bedingungen nutzen dürfen. Für die Einwilligung in die Verarbeitung von Gesundheitsdaten (Abschnitt 4) musst du mindestens [MINDESTALTER, zum Beispiel 16] Jahre alt sein. Bist du jünger, brauchst du die Zustimmung deiner Eltern oder Erziehungsberechtigten.

## 11. Pflicht zur Bereitstellung

Du musst Ember keine Daten geben. Ohne Discord-Nutzer-ID, Habit-Namen und Check-ins kann Ember aber nicht funktionieren. Zeitzone, Erinnerungen, Gnadentage und die Bestenliste sind freiwillig.

## 12. Änderungen

Wenn sich Ember ändert, passen wir diese Erklärung an. Das aktuelle Datum steht oben. Über wichtige Änderungen informieren wir dich in Ember, zum Beispiel über `/help`. Brauchen wir für etwas Neues deine Einwilligung, fragen wir dich vorher.
