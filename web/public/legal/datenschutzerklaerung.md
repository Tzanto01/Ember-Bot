# Datenschutzerklärung für Ember

> **English summary (not binding; the German text below is the binding version).**
> Ember is a free habit tracker. You can use it through a Discord bot, a web app and (once it is published) an Android app. The operator runs it privately, on a server in Germany. You can use Ember with an account (synced across your devices) or without one (then your data stays on your device). An account needs an email address and a password, or a Discord login. Habit names, check-ins, low days, journal entries and moods can reveal health information, so Ember stores them only with your explicit consent (GDPR Art. 9(2)(a)). The private journal can be encrypted end to end, so the server then holds only ciphertext. Ember shows no ads, uses no analytics or tracking and no AI, and sells no data. Discord carries your messages as the platform. You can export your data and delete everything at once.

---

**Stand:** 11. November 2026

Ember ist ein kostenloser Habit Tracker. Diese Erklärung sagt dir, welche Daten Ember verarbeitet, warum, wie lange und welche Rechte du hast.

## 1. Wer ist verantwortlich?

Verantwortlich im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:

Nico Pauly Wöllnitz
Erzbergerstraße 129
46145 Oberhausen
Deutschland

E-Mail: contact@nicowoellnitz.de

Ember wird privat und nicht kommerziell betrieben. Einen Datenschutzbeauftragten gibt es nicht, weil dafür keine gesetzliche Pflicht besteht. Bei allen Fragen zum Datenschutz schreib an die E-Mail-Adresse oben.

## 2. Das Wichtigste in Kürze

- Ember speichert nur, was die Funktionen brauchen: dein Konto, deine Habits, Check-ins, Tagebucheinträge und Erinnerungen.
- Habit-Namen, Check-ins, Tiefs, Tagebucheinträge und Stimmungen können etwas über deine Gesundheit verraten. Ember speichert sie nur mit deiner ausdrücklichen Einwilligung.
- Das private Tagebuch kannst du Ende-zu-Ende verschlüsseln. Dann liegt auf dem Server nur Text, den wir nicht lesen können.
- Keine Werbung, kein Tracking, keine Analyse-Dienste, keine KI. Wir verkaufen keine Daten.
- Du kannst deine Daten jederzeit exportieren und alles auf einmal löschen.

## 3. Welche Daten verarbeitet Ember?

Ember legt Daten nur an, wenn du eine Funktion nutzt, die sie braucht. Du kannst Ember auch ganz ohne Konto nutzen (siehe 3.9).

### 3.1 Konto und Anmeldung

| Daten | Wofür |
|---|---|
| E-Mail-Adresse und Passwort (das Passwort nur als nicht umkehrbaren Hash) | Anmeldung, Bestätigung der E-Mail-Adresse und Zurücksetzen des Passworts. Konten, die nur mit Discord angelegt wurden, haben keine E-Mail-Adresse. |
| Discord-Nutzer-ID, wenn du Discord verbunden hast | Damit du dich mit Discord anmelden kannst und der Discord-Bot dich deinem Konto zuordnet. Ember fragt bei Discord nur die Nutzer-ID ab (Berechtigung „identify“). Name und Profilbild speichern wir nicht. |
| Zwei-Faktor-Anmeldung: geheimer Schlüssel für deine Authenticator-App und Wiederherstellungscodes [PRÜFEN: Wiederherstellungscodes werden nur gehasht gespeichert] | Damit der Anmeldecode geprüft und die Anmeldung zusätzlich geschützt werden kann. |
| Zeitzone, Design, Gnadentage, Einstellung für die zweite Erinnerung | Damit „heute“, Streaks und Erinnerungen nach deiner Uhrzeit laufen. Hast du keine Zeitzone gewählt, übernimmt die App die Zeitzone deines Geräts. |
| Einwilligungsnachweis: Zeitpunkt, Version der Datenschutzerklärung und der Tag, an dem Ember dich zuletzt gefragt hat | Damit wir nachweisen können, dass du eingewilligt hast (Art. 7 Abs. 1 DSGVO), und dich bei einer neuen Version erneut fragen können. |

### 3.2 Habits, Check-ins und Routinen

Gesundheitsbezogene Daten, siehe Abschnitt 4.

| Daten | Wofür |
|---|---|
| Habit-Name (höchstens 100 Zeichen), Häufigkeit (täglich, an bestimmten Wochentagen oder x-mal pro Woche), Anzahl Check-ins pro Tag, Erinnerungszeit, Pause (erster und letzter pausierter Tag), Erinnerungskanäle, Erstellungszeitpunkt | Damit Ember deine Habits anzeigt, auswertet und dich daran erinnert. |
| Routine: Name (höchstens 50 Zeichen), Erinnerungszeit, Erinnerungskanäle und welche Habits dazugehören | Damit du Habits zusammenfassen und gemeinsam erinnert werden kannst. [PRÜFEN: Routinen-Namen sind bisher nicht durch die Einwilligung geschützt, siehe Abschnitt 4] |
| Check-ins: Datum (ohne Uhrzeit), erledigt oder nicht, Anzahl; bei Check-ins über Discord außerdem die ID des Servers, auf dem du sie gemacht hast (leer bei Check-ins in einer Direktnachricht) | Damit Ember Streaks sowie Wochen- und Jahresübersichten berechnen kann. Du kannst vergangene Tage ab dem Start eines Habits nachtragen, ändern oder leeren. |
| Tiefs: das Datum jedes Tages, den du als Tief markierst. Ein Tief gilt für alle deine Habits. | Ein Tief schützt deine Streaks an diesem Tag. Du kannst es jederzeit wieder entfernen. |
| Gnadentage pro Woche (0 bis 3) | Ein verpasster Tag beendet deinen Streak nicht sofort. |
| Nächster geplanter Erinnerungszeitpunkt (UTC) und, falls eine zweite Erinnerung ansteht, ihr Zeitpunkt | Damit Erinnerungen pünktlich kommen, auch bei Sommer- und Winterzeit. |
| Erinnerungen in Discord, die noch Schaltflächen haben: Kanal-ID, Nachrichten-ID und Tag | Damit Ember die Nachricht schließen kann, sobald sie nicht mehr gebraucht wird. Der Eintrag wird gelöscht, wenn die Nachricht geschlossen ist. |
| Zustellstatus der Erinnerungs-DMs: Zahl der fehlgeschlagenen Zustellungen in Folge, Zeitpunkt der Pause und des Hinweises | Wenn Discord deine Nachrichten mehrmals hintereinander nicht zustellen kann (zum Beispiel weil du DMs von Servermitgliedern ausgeschaltet hast), pausiert Ember die Erinnerungen und sagt dir das einmal. |

### 3.3 Tagebuch und Stimmungen

Gesundheitsbezogene Daten, siehe Abschnitt 4.

| Daten | Wofür |
|---|---|
| Tagesnotiz: Text (höchstens 2000 Zeichen) und/oder Stimmung für einen Tag | Damit du deinen Tag festhalten kannst. Eine Tagesnotiz gehört zum ganzen Tag, nicht zu einem einzelnen Habit. |
| Eigene Stimmungen: Bezeichnung (höchstens 24 Zeichen) und optional ein Emoji | Damit du eigene Stimmungen auswählen kannst. Archivierte Stimmungen bleiben an den Tagen sichtbar, an denen du sie gesetzt hast. |

Tagesnotizen und Stimmungen liegen **im Klartext** auf dem Server, solange du das private Tagebuch (3.4) nicht einschaltest.

### 3.4 Privates Tagebuch (optional, Ende-zu-Ende verschlüsselt)

Schaltest du das private Tagebuch ein, erzeugt dein Browser oder deine App einen zufälligen Schlüssel. Er wird mit einer Passphrase und einem Wiederherstellungscode verschlüsselt, die du selbst festlegst beziehungsweise erhältst. Tagesnotizen und eigene Stimmungen werden auf deinem Gerät verschlüsselt, bevor sie zum Server gelangen.

- Auf dem Server liegen nur verschlüsselte Einträge, der verschlüsselte Schlüssel sowie Salt und Parameter für die Entschlüsselung.
- Passphrase und Wiederherstellungscode verlassen dein Gerät nicht.
- Verlierst du beides, kann niemand die Einträge wieder lesen, auch wir nicht.
- Auch mit dem privaten Tagebuch bleiben E-Mail-Adresse, Discord-Nutzer-ID, Habit- und Routinen-Namen, Check-ins mit Zeitangaben und Tiefs für den Server lesbar, weil Erinnerungen und Statistiken sie brauchen.
- Schaltest du es wieder aus, lädt dein Gerät die Einträge wieder im Klartext hoch.

### 3.5 Erinnerungen und Benachrichtigungen

- **Discord-Direktnachrichten:** Erinnerungen, die Einladung, einen offenen Tag nachzutragen, Hinweise zu Pausen und Lücken sowie die Wochenübersicht. Die Nachrichten laufen über Discord (siehe 6.1).
- **Web-Push (Benachrichtigungen im Browser):** Wenn du sie einschaltest, speichert Ember die Adresse (Endpunkt), die dein Browser beim Push-Dienst bekommt, und zwei Schlüssel für die Verschlüsselung. Die Nachricht ist verschlüsselt. Standardmäßig nennt sie keinen Habit-Namen, weil sie auf dem Sperrbildschirm erscheinen kann.
- **Android-App:** Erinnerungen plant die App auf deinem Gerät, damit sie auch ohne Internet kommen. Das Widget auf dem Startbildschirm zeigt deine heutigen Habits. Beim Abmelden leert die App beides. [PRÜFEN: Die App ist noch nicht veröffentlicht. Die Build-Konfiguration enthält das Google-Services-Plugin, die App nutzt aber kein Firebase-Messaging. Vor der Veröffentlichung prüfen, dass kein Google-Push für Ember aktiv ist.]

### 3.6 Daten, die Ember nur kurz verwendet

- **Dein Discord-Anzeigename**, wenn du mit `/habit share` eine Streak-Karte in einem Kanal postest. Der Name steht dann auf der Karte. Ember speichert ihn nicht.
- **Technische Angaben zu jeder Discord-Interaktion**, zum Beispiel aus welchem Server oder Kanal ein Befehl kommt. Ember nutzt sie nur, um zu antworten. Gespeichert wird davon nur die Server-ID bei einem Check-in.
- **Deine IP-Adresse:** Ember nutzt sie im Arbeitsspeicher, um zu viele Anfragen abzuwehren (Ratenbegrenzung). Sie wird nicht in der Datenbank gespeichert. [PRÜFEN: Zugriffsprotokolle des Servers oder eines Reverse-Proxys können IP-Adressen enthalten. Speicherdauer festlegen.]

### 3.7 Technische Protokolle (Logs)

Die Dienste schreiben technische Protokolle, zum Beispiel wenn eine Erinnerung nicht zugestellt werden kann oder ein Fehler auftritt. Darin stehen Nutzer-IDs, interne Nummern von Habits, Zeitpunkte und Fehlermeldungen. Habit-Namen stehen dort nicht. E-Mail-Adressen stehen dort nicht; bei E-Mails steht nur die Domain des Empfängers. Die Protokolle dienen nur dazu, Fehler zu finden und den Betrieb sicher zu halten. Sie werden derzeit nach Größe rotiert: pro Dienst bleiben drei Dateien mit je 10 MB. [PRÜFEN: Eine feste Löschfrist (zum Beispiel 30 Tage) einrichten und hier nennen, oder diesen Satz ändern.]

### 3.8 Cookies und Speicher im Browser

Ember setzt keine Cookies für Werbung oder Tracking. Diese Cookies sind technisch notwendig, damit Anmeldung und Schutz funktionieren:

| Name | Zweck | Dauer |
|---|---|---|
| `__Host-Ember` | Hält dich angemeldet. Nur über HTTPS, für JavaScript nicht lesbar. | Sitzung. Mit „Angemeldet bleiben“ länger. [PRÜFEN: genaue Laufzeit prüfen] |
| `XSRF-TOKEN` | Schutz vor Anfragen, die andere Seiten in deinem Namen senden. | Sitzung |
| ASP.NET-Schutz-Cookie für Formulare | Schutz vor gefälschten Anfragen. | Sitzung |
| `Identity.External` und Cookies des Discord-Anmeldevorgangs | Nur während der Anmeldung mit Discord. | Minuten |
| `Identity.TwoFactorUserId` | Zwischenschritt bei der Zwei-Faktor-Anmeldung. | Minuten |
| `__Secure-ember.merge` | Hält einen angefragten Kontoabgleich mit Discord für 15 Minuten. | 15 Minuten |

Auch im Browser speichert die Web-App einige Dinge: im Local Storage deine Einstellungen (Design, Modus mit oder ohne Konto, Einstellungen für Erinnerungen in der App) und kleine Merker, und in IndexedDB die Warteschlange für Änderungen, die du offline gemacht hast, eine Kopie deiner Habit-Liste zum schnellen Anzeigen und, nur wenn du „Auf diesem Gerät merken“ wählst, den Schlüssel des privaten Tagebuchs in einer Form, die JavaScript nicht auslesen kann. Die Android-App speichert Anmeldetoken und einen gemerkten Tagebuchschlüssel im sicheren Speicher des Geräts. Beim Abmelden löscht die App die lokalen Daten dieses Kontos.

Die Speicherung im Browser ist technisch notwendig (§ 25 Abs. 2 Nr. 2 TDDDG). Eine Einwilligung dafür brauchen wir nicht.

### 3.9 Ohne Konto: Daten nur auf dem Gerät

Wenn du Ember ohne Konto nutzt, bleiben alle Daten auf deinem Gerät: Habits, Check-ins, Tiefs, Routinen, Tagesnotizen, Stimmungen und Einstellungen. Sie gehen nicht an den Server, nicht an Discord und nicht an Push-Dienste. Der Browser oder das Betriebssystem kann sie löschen, zum Beispiel wenn du die Website-Daten entfernst, die App deinstallierst oder Safari eine Website nach sieben Tagen ohne Besuch aufräumt. Mit „Sicherung exportieren“ speicherst du eine Datei mit deinen Daten.

Legst du später ein Konto an, lädt die App deine Daten hoch. Die lokale Kopie löscht sie erst, wenn alle Schritte erfolgreich waren.

### 3.10 Was Ember nicht verarbeitet

- Nachrichteninhalte aus Discord. Der Bot liest keine Nachrichten mit und nutzt keine privilegierten Gateway-Intents.
- Mitgliederlisten, Online-Status und Freundeslisten.
- Standortdaten, Kontakte, Telefonnummern und Zahlungsdaten. Ember hat keine Bezahlfunktion.
- Werbe-Kennungen und Geräte-Fingerabdrücke.

## 4. Gesundheitsdaten (Art. 9 DSGVO)

Viele Habits haben mit Gesundheit zu tun, zum Beispiel „Medikamente nehmen“, „Schlafen“ oder „Sport“. Ember bietet einige davon sogar als Vorlage an. Aus Habit-Namen, Check-ins, Tiefs, Tagesnotizen und Stimmungen lässt sich deshalb unter Umständen etwas über deine Gesundheit ablesen. Solche Daten sind nach Art. 9 DSGVO besonders geschützt.

Wir behandeln deshalb **alle** Habit-Namen, Check-ins, Tiefs, Tagesnotizen und Stimmungen so, als könnten sie Gesundheitsdaten sein. Ember speichert sie nur mit deiner **ausdrücklichen Einwilligung** (Art. 9 Abs. 2 lit. a DSGVO). [PRÜFEN: Routinen-Namen sind bisher nicht von der Einwilligung umfasst, obwohl sie ebenfalls Gesundheitsangaben enthalten können. Entscheidung offen.]

### So fragt Ember nach deiner Einwilligung

- **Neue Nutzer:** Bevor du dein erstes Habit anlegst (auch aus einer Vorlage) oder ein Tief oder eine Tagesnotiz speicherst, fragt Ember dich, ob das für dich in Ordnung ist. Im Discord-Bot antwortest du mit den Schaltflächen „I agree“ oder „No thanks“. In der Web-App und der App ist es eine eigene Seite. Erst nach deiner Zustimmung speichert Ember diese Daten.
- **Bestehende Nutzer:** Wenn du Ember schon vor der Einwilligung genutzt hast, fragt die Web-App dich einmal pro Sitzung und der Discord-Bot höchstens einmal am Tag. Bis du antwortest, bleiben deine vorhandenen Habits und Check-ins nutzbar und die Erinnerungen laufen weiter. Neue Habits, Tiefs und Tagesnotizen gehen erst nach deiner Zustimmung. [PRÜFEN: Art. 9 für bestehende Nutzer, das heißt Check-ins ohne Einwilligung bis zur Antwort. Entscheidung offen.]
- **Wenn du „No thanks“ wählst oder die Frage nicht beantwortest:** Ember speichert keine Einwilligung und legt nichts Neues an. Was schon da ist, bleibt, bis du entscheidest. Ember bietet dir dann an, deine Daten zu löschen.
- **Wenn sich diese Erklärung ändert:** Bei einer neuen Version fragt Ember dich erneut, auf dieselbe Weise.

Wenn du zustimmst, speichert Ember den Zeitpunkt und die Version dieser Erklärung (Abschnitt 3.1).

### Tagesnotizen, Stimmungen und Tiefs sind privat

Tagesnotizen und Stimmungen erscheinen nie im Discord-Bot, in Benachrichtigungen oder in der Wochenübersicht. Ein Tief erscheint auf einer Streak-Karte, die du mit `/habit share` postest, nur als normale Lücke.

### Widerruf

Du kannst deine Einwilligung jederzeit widerrufen (Art. 7 Abs. 3 DSGVO). Ohne Habit-Namen und Check-ins kann Ember seinen Dienst nicht erbringen. Deshalb ist das Löschen des Kontos derzeit der einzige Weg, die Einwilligung zu widerrufen: in der Web-App und der App unter „Deine Daten“ beziehungsweise „Konto löschen“ oder im Discord-Bot mit `/privacy delete`. Das löscht alles sofort. [PRÜFEN: Ob ein eigener Widerruf ohne Kontolöschung nötig ist.] Was bis zum Widerruf passiert ist, bleibt rechtmäßig.

## 5. Zwecke und Rechtsgrundlagen

| Zweck | Rechtsgrundlage |
|---|---|
| Konto, Anmeldung, Bestätigung der E-Mail-Adresse, Zurücksetzen des Passworts, Zwei-Faktor-Anmeldung, Verknüpfung mit Discord | Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag, siehe Nutzungsbedingungen). Für die Sicherheit des Kontos zusätzlich Art. 6 Abs. 1 lit. f DSGVO. |
| Habits, Check-ins, Tiefs, Gnadentage, Streaks, Statistiken, Erinnerungen, Wochenübersicht, Export und Löschung | Art. 6 Abs. 1 lit. b DSGVO. Für Habit-Namen, Check-ins und Tiefs zusätzlich Art. 9 Abs. 2 lit. a DSGVO (Einwilligung). |
| Tagesnotizen und Stimmungen | Art. 6 Abs. 1 lit. b DSGVO und Art. 9 Abs. 2 lit. a DSGVO (Einwilligung). |
| Erinnerungen über Discord, Web-Push und lokal in der App | Art. 6 Abs. 1 lit. b DSGVO. Jeden Kanal schaltest du selbst ein. |
| E-Mails zur Bestätigung und zum Zurücksetzen des Passworts | Art. 6 Abs. 1 lit. b DSGVO |
| Einwilligungsnachweis | Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit Art. 7 Abs. 1 DSGVO |
| Technische Protokolle, Ratenbegrenzung, Fehlersuche, Sicherheit, Backups | Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist ein sicherer, stabiler Betrieb und dass deine Daten nach einem technischen Ausfall nicht verloren gehen. |
| Cookies und Speicher im Browser (Abschnitt 3.8) | § 25 Abs. 2 Nr. 2 TDDDG. Die Verarbeitung der Daten selbst richtet sich nach den Zeilen oben. |

Es gibt keine automatisierte Entscheidungsfindung und kein Profiling im Sinne von Art. 22 DSGVO. Streaks und Statistiken sind einfache Berechnungen, die nur dir angezeigt werden und keine rechtliche oder ähnlich erhebliche Wirkung haben.

## 6. Wer bekommt deine Daten?

### 6.1 Discord

Ember läuft über Discord. Was du im Bot tust und was Ember dir schickt (Antworten, Erinnerungen, Wochenübersichten, Exporte), läuft über die Server von Discord. Discord verarbeitet diese Daten als eigener Verantwortlicher nach seinen eigenen Regeln. Mit Discord hast du einen eigenen Vertrag. Discord ist kein Auftragsverarbeiter von Ember.

- Anbieter: Discord Inc., USA. [PRÜFEN: ob Discord für Nutzer im EWR eine EU-Gesellschaft als Verantwortliche nennt]
- Datenschutzerklärung von Discord: https://discord.com/privacy
- Drittlandübermittlung: Discord verarbeitet Daten auch in den USA. [PRÜFEN: Grundlage laut Discord, zum Beispiel EU-US Data Privacy Framework oder Standardvertragsklauseln]

Die Verbindung zwischen dir und Discord ist verschlüsselt (TLS).

**Bitte beachte:** Direktnachrichten von Ember, Streak-Karten aus `/habit share` und Nachrichten in einem Kanal liegen bei Discord. Ember kann sie nach dem Senden nicht zurückholen, auch nicht mit `/privacy delete`. Moderatoren eines Servers können Streak-Karten in ihrem Server löschen.

### 6.2 Hosting und öffentlicher Zugang

Ember läuft auf einem Server in Deutschland, den der Verantwortliche selbst betreibt, zu Hause. Es gibt keinen Dienstleister, der den Server betreibt oder Zugriff auf die Datenbank hat.

Die Web-App und die API sind öffentlich über einen Cloudflare Tunnel erreichbar. Dabei gilt:

- **Cloudflare, Inc.**, USA, ist Auftragsverarbeiter nach Art. 28 DSGVO. Cloudflare nimmt die Verbindungen aus dem Internet entgegen und leitet sie über den Tunnel an unseren Server weiter.
- Cloudflare beendet die TLS-Verschlüsselung. Dadurch kann Cloudflare die Inhalte der Anfragen sehen, die über den Tunnel laufen, also auch deine Eingaben in der Web-App. Cloudflare sieht außerdem deine IP-Adresse und technische Verbindungsdaten.
- Cloudflare verarbeitet Daten auch in den USA. Die Übermittlung stützt sich auf das EU-US Data Privacy Framework und, soweit es nicht greift, auf Standardvertragsklauseln. Der Auftragsverarbeitungsvertrag (DPA) von Cloudflare wird vor dem Start im Cloudflare-Dashboard akzeptiert.
- Die Datenbank, Discord-Bot und Ember selbst bleiben auf dem eigenen Server.

[PRÜFEN: gilt ab dem öffentlichen Start über den Tunnel. Zertifizierung im Data Privacy Framework und Vertragslage bei Cloudflare zum Starttermin prüfen; Domain ember-glow.app.]

### 6.3 E-Mail-Versand

Bestätigungs- und Passwort-E-Mails verschickt Ember über den Dienst **Brevo** (Sendinblue SAS, Frankreich) als Auftragsverarbeiter nach Art. 28 DSGVO. Übermittelt werden die Empfängeradresse, der Betreff und der Text. Der Text enthält einen Link mit einem Code für die Bestätigung oder das Zurücksetzen des Passworts. [PRÜFEN: Auftragsverarbeitungsvertrag mit Brevo abgeschlossen, Speicherdauer bei Brevo und Verarbeitungsort.]

### 6.4 Push-Dienste der Browser

Wenn du Web-Push einschaltest, schickt Ember die Nachricht über den Push-Dienst deines Browsers. Je nach Browser ist das Google (Chrome und andere Chromium-Browser, auch auf Android), Mozilla (Firefox), Apple (Safari, auch für installierte Web-Apps auf dem iPhone) oder Microsoft (Edge unter Windows). Der Push-Dienst sieht die Adresse deines Browser-Abos und den Zeitpunkt der Nachricht. Den Inhalt kann er nicht lesen, weil Ember ihn verschlüsselt. Die Push-Dienste verarbeiten diese Daten nach ihren eigenen Datenschutzregeln. [PRÜFEN: Drittlandübermittlung der Push-Dienste und ob sie als eigene Verantwortliche gelten.]

### 6.5 Sonst niemand

Wir geben deine Daten an niemanden weiter, verkaufen sie nicht und nutzen sie nicht für Werbung. Ember setzt keine Analyse-, Tracking- oder KI-Dienste ein. Schriften und Skripte lädt Ember nicht von fremden Servern. Eine Weitergabe an Behörden erfolgt nur, wenn ein Gesetz es verlangt.

## 7. Wie lange speichert Ember deine Daten?

- **Dein Konto und deine Daten** bleiben gespeichert, bis du sie löschst. Einzelne Habits, Routinen, Check-ins, Tiefs, Tagesnotizen und Stimmungen kannst du in der App oder im Bot entfernen. Die Kontolöschung entfernt alles sofort (Abschnitt 9).
- **Konten, deren E-Mail-Adresse nie bestätigt wurde,** bleiben gespeichert, bis die Adresse bestätigt oder das Konto gelöscht wird. [PRÜFEN: automatische Löschung nach einer Frist einrichten oder hier nichts ändern.]
- **Erinnerungen in Discord:** Der Eintrag bleibt, bis die Nachricht geschlossen oder ersetzt wird. Danach wird er gelöscht.
- **Web-Push-Abos:** bis du sie abmeldest, Benachrichtigungen ausschaltest, der Push-Dienst das Abo als ungültig meldet oder dein Konto gelöscht wird. Beim Abmelden entfernt die App das Abo.
- **Technische Protokolle:** siehe Abschnitt 3.7.
- **Backups:** Ember sichert die Datenbank regelmäßig. Ältere Sicherungen werden nach einem festen Zyklus überschrieben. Bis dahin können gelöschte Daten noch in einem Backup stehen. Backups nutzen wir nur, um den Betrieb nach einem technischen Ausfall wiederherzustellen. Wird ein Backup eingespielt, können dort gelöschte Daten wieder auftauchen. [PRÜFEN: Zyklus (Vorschlag 30 Tage), Speicherort (außerhalb des Servers?), Verschlüsselung und ob die Sicherung wirklich läuft. Nur veröffentlichen, was tatsächlich läuft.]
- **Daten bei Discord:** nach den Regeln von Discord.
- **Ohne Konto:** auf dem Gerät, bis du sie löschst oder Browser beziehungsweise Betriebssystem sie entfernen.

## 8. Wie schützen wir deine Daten?

- **Datensparsamkeit:** Ember speichert nur die oben genannten Daten. Check-ins haben nur ein Datum, keine Uhrzeit.
- **Kein Mitlesen von Chats:** Der Bot liest keine Nachrichten mit.
- **Verschlüsselte Verbindung:** Web-App und API sind nur über HTTPS erreichbar.
- **Passwörter:** Ember speichert nur einen Hash. Nach fünf Fehlversuchen ist die Anmeldung 15 Minuten gesperrt. Zusätzlich begrenzt Ember die Anzahl der Anfragen.
- **Zwei-Faktor-Anmeldung:** optional mit einer Authenticator-App und Wiederherstellungscodes.
- **Privates Tagebuch:** Ende-zu-Ende verschlüsselt (Abschnitt 3.4).
- **Privat als Standard:** Antworten auf deine Befehle sieht in der Regel nur du. Öffentlich wird nur, was du selbst postest (`/habit share`).
- **Zugriff:** Nur der Verantwortliche hat Zugriff auf den Server und die Datenbank.
- **Löschen auf Knopfdruck:** Die Kontolöschung entfernt alles sofort.

## 9. Deine Rechte

Du hast nach der DSGVO diese Rechte:

- **Auskunft** (Art. 15): welche Daten wir über dich haben.
- **Berichtigung** (Art. 16): falsche Daten korrigieren lassen.
- **Löschung** (Art. 17): deine Daten löschen lassen.
- **Einschränkung der Verarbeitung** (Art. 18).
- **Datenübertragbarkeit** (Art. 20): deine Daten in einem gängigen, maschinenlesbaren Format.
- **Widerspruch** (Art. 21) gegen Verarbeitungen auf Grundlage berechtigter Interessen (Abschnitt 5, Zeile mit lit. f).
- **Widerruf von Einwilligungen** (Art. 7 Abs. 3), jederzeit mit Wirkung für die Zukunft.

Die meisten Rechte kannst du selbst ausüben:

| Was du willst | So geht es |
|---|---|
| Alle deine Daten sehen oder mitnehmen | Web-App oder App: Einstellungen, Abschnitt „Deine Daten“, Export als JSON oder CSV. Discord: `/export`. Der Export enthält deine Einstellungen (mit dem Einwilligungsnachweis), alle Habits, Routinen, Check-ins, Tiefs, Tagesnotizen und Stimmungen. Ein verschlüsseltes Tagebuch bleibt in der Datei verschlüsselt. Die App bietet außerdem einen entschlüsselten Export deines Tagebuchs an. |
| Alles löschen | Web-App oder App: Einstellungen, „Konto löschen“. Mit Passwort, bei Konten ohne Passwort durch Eingabe von DELETE. Discord: `/privacy delete` und bestätigen. Das lässt sich nicht rückgängig machen. Exportiere vorher, wenn du deine Daten behalten möchtest. |
| Ein Habit löschen oder umbenennen, die Häufigkeit oder die Erinnerung ändern | Discord: `/habit delete`, `/habit edit`, `/habit frequency`. Web-App: Habit bearbeiten. |
| Einen Check-in korrigieren, nachtragen oder ein Tief setzen oder entfernen | Discord: `/habit history`. Web-App: Kalender des Habits. |
| Eine Tagesnotiz oder Stimmung ändern | Web-App oder App (Tagebuch). |
| Discord trennen | Web-App oder App: Einstellungen. Das geht nur, wenn du ein Passwort und eine bestätigte E-Mail-Adresse hast, sonst könntest du dich nicht mehr anmelden. |

Für alles andere, oder wenn etwas nicht funktioniert, schreib an contact@nicowoellnitz.de. Wir antworten so schnell wie möglich, spätestens innerhalb eines Monats. Damit wir sicher sind, dass die Anfrage von dir kommt, fragen wir eventuell nach deiner Discord-Nutzer-ID oder bitten dich, dich über Discord zu bestätigen.

### Beschwerderecht

Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO). Für uns zuständig ist:

Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen
Kavalleriestraße 2-4, 40213 Düsseldorf
www.ldi.nrw.de [PRÜFEN: Anschrift und Website aktuell?]

Wir freuen uns aber, wenn du uns zuerst schreibst. Oft lässt sich etwas schnell klären.

## 10. Mindestalter

Ember richtet sich an Menschen, die Discord nach dessen Bedingungen nutzen dürfen. Für die Einwilligung in die Verarbeitung von Gesundheitsdaten (Abschnitt 4) musst du mindestens **[PRÜFEN: Mindestalter festlegen, Vorschlag 16]** Jahre alt sein. Bist du jünger, brauchst du die Zustimmung deiner Eltern oder Erziehungsberechtigten. Ember kann das Alter nicht prüfen.

## 11. Pflicht zur Bereitstellung

Du musst Ember keine Daten geben. Ohne ein Konto mit E-Mail-Adresse oder Discord-Anmeldung, ohne Habit-Namen und Check-ins kann Ember auf dem Server aber nicht arbeiten. Du kannst Ember dann vollständig auf deinem Gerät nutzen (Abschnitt 3.9). Zeitzone, Erinnerungen, Gnadentage, Tiefs, Tagesnotizen und Stimmungen sind freiwillig. Die Einwilligung (Abschnitt 4) brauchst du, um Habits anzulegen und Tiefs oder Tagesnotizen zu speichern.

## 12. Änderungen

Wenn sich Ember ändert, passen wir diese Erklärung an. Das Datum oben zeigt die aktuelle Fassung. Über wichtige Änderungen informieren wir dich in Ember. Brauchen wir für etwas Neues deine Einwilligung, fragen wir dich vorher, wie in Abschnitt 4 beschrieben.
