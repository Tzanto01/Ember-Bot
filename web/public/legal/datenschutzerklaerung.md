# Datenschutzerklärung für Ember

> **English summary (not binding; the German text below is the binding version).**
> Ember is a free habit tracker. You can use it through a Discord bot, a web app and (once it is published) an Android app. The operator runs it privately, on a server in Germany. You can use Ember with an account (synced across your devices) or without one (then your data stays on your device). An account needs an email address and a password, or a Discord login. Habit names, check-ins, low days, day notes and moods can reveal health information, so Ember stores them only with your explicit consent (GDPR Art. 9(2)(a)). Routine names, habit renames and push subscriptions do not need that consent yet (open point). The private journal can be encrypted end to end, so the server then holds only ciphertext for day notes and moods. Ember shows no ads, uses no analytics or tracking and no AI, and sells no data. Discord carries your messages as the platform. You can export your data and delete everything at once.

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

- Ember speichert nur, was die Funktionen brauchen: dein Konto, deine Habits, Check-ins, Tagesnotizen und Erinnerungen.
- Habit-Namen, Check-ins, Tiefs, Tagesnotizen und Stimmungen können etwas über deine Gesundheit verraten. Ember speichert sie nur mit deiner ausdrücklichen Einwilligung. Routinen-Namen brauchen bisher keine Einwilligung. [PRÜFEN: Entscheidung offen, siehe Abschnitt 4.]
- Das private Tagebuch kannst du Ende-zu-Ende verschlüsseln. Dann liegen Tagesnotizen und eigene Stimmungen auf dem Server nur verschlüsselt.
- Keine Werbung, kein Tracking, keine Analyse-Dienste, keine KI. Wir verkaufen keine Daten.
- Du kannst deine Daten jederzeit exportieren und alles auf einmal löschen.

## 3. Welche Daten verarbeitet Ember?

Ember legt Daten nur an, wenn du eine Funktion nutzt, die sie braucht. Du kannst Ember auch ganz ohne Konto nutzen (siehe 3.9).

### 3.1 Konto und Anmeldung

| Daten | Wofür |
|---|---|
| E-Mail-Adresse und Passwort (das Passwort nur als nicht umkehrbaren Hash) | Anmeldung, Bestätigung der E-Mail-Adresse und Zurücksetzen des Passworts. Konten, die nur mit Discord angelegt wurden, haben keine E-Mail-Adresse. |
| Anmeldeversuche: Zahl der fehlgeschlagenen Versuche und Ende einer Sperre | Schutz vor Ratenangriffen auf dein Passwort. Die Zahl setzt sich bei der nächsten erfolgreichen Anmeldung zurück. |
| Discord-Nutzer-ID, wenn du Discord verbunden hast | Damit du dich mit Discord anmelden kannst und der Discord-Bot dich deinem Konto zuordnet. Ember fragt bei Discord die Berechtigung „identify“ an. Discord liefert dabei auch Name und Profilbild. Ember übernimmt davon nur die Nutzer-ID und verwirft den Rest. |
| Zwei-Faktor-Anmeldung: geheimer Schlüssel für deine Authenticator-App und Wiederherstellungscodes. Ein Wiederherstellungscode gilt nur einmal und wird nach der Benutzung entwertet. | Damit der Anmeldecode geprüft und die Anmeldung zusätzlich geschützt werden kann. |
| Anmeldesitzungen: eine Sitzungs-ID pro Anmeldung auf einem Gerät, Zeitpunkt der Anmeldung, Ablaufzeit und letzte Nutzung. Keine IP-Adresse. | Damit du dich auf einem Gerät oder auf allen Geräten abmelden kannst (Abschnitt 8). |
| Zeitzone, Design, Gnadentage, Einstellung für die zweite Erinnerung | Damit „heute“, Streaks und Erinnerungen nach deiner Uhrzeit laufen. Hast du keine Zeitzone gewählt, übernimmt die App die Zeitzone deines Geräts. |
| Einwilligungsnachweis: Zeitpunkt, Version der Datenschutzerklärung und der Tag der letzten Abfrage. Hast du „No thanks“ gewählt, steht dort das Ende der 30-Tage-Pause. | Damit wir nachweisen können, dass du eingewilligt hast (Art. 7 Abs. 1 DSGVO), und dich bei einer neuen Version erneut fragen können. |
| Erstellungszeitpunkt des Kontos | Steckt in der Konto-ID (UUIDv7). Ember speichert ihn nicht als eigenes Feld. Damit werden nie bestätigte Konten nach 7 Tagen gelöscht (Abschnitt 7). |

### 3.2 Habits, Check-ins und Routinen

Gesundheitsbezogene Daten, siehe Abschnitt 4.

| Daten | Wofür |
|---|---|
| Habit-Name (höchstens 100 Zeichen), Häufigkeit (täglich, an bestimmten Wochentagen oder x-mal pro Woche), Anzahl Check-ins pro Tag, Erinnerungszeit, Pause (erster und letzter pausierter Tag), Erinnerungskanäle, Erstellungszeitpunkt | Damit Ember deine Habits anzeigt, auswertet und dich daran erinnert. |
| Routine: Name (höchstens 50 Zeichen), Erinnerungszeit, Erinnerungskanäle, welche Habits dazugehören und Erstellungszeitpunkt | Damit du Habits zusammenfassen und gemeinsam erinnert werden kannst. [PRÜFEN: Routinen-Namen können Gesundheitsangaben enthalten. Die Einwilligung deckt sie bisher nicht ab, siehe Abschnitt 4.] |
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
| Eigene Stimmungen: Bezeichnung (höchstens 24 Zeichen), optional ein Emoji, ob sie archiviert ist, und Erstellungszeitpunkt | Damit du eigene Stimmungen auswählen kannst. Archivierte Stimmungen bleiben an den Tagen sichtbar, an denen du sie gesetzt hast. |

Tagesnotizen und Stimmungen liegen **im Klartext** auf dem Server, solange du das private Tagebuch (3.4) nicht einschaltest.

### 3.4 Privates Tagebuch (optional, Ende-zu-Ende verschlüsselt)

Schaltest du das private Tagebuch ein, erzeugt dein Browser oder deine App einen zufälligen Schlüssel. Er wird mit einer Passphrase und einem Wiederherstellungscode verschlüsselt, die du selbst festlegst beziehungsweise erhältst. Tagesnotizen und eigene Stimmungen werden auf deinem Gerät verschlüsselt, bevor sie zum Server gelangen.

- Auf dem Server liegen nur verschlüsselte Einträge, der verschlüsselte Schlüssel sowie Salt und Parameter für die Entschlüsselung.
- Passphrase und Wiederherstellungscode verlassen dein Gerät nicht.
- Verlierst du beides, kann niemand die Einträge wieder lesen, auch wir nicht.
- Auch mit dem privaten Tagebuch bleiben E-Mail-Adresse, Discord-Nutzer-ID, Habit- und Routinen-Namen, Check-ins mit Datum und Tiefs für den Server lesbar, weil Erinnerungen und Statistiken sie brauchen.
- Schaltest du es wieder aus, lädt dein Gerät die Einträge wieder im Klartext hoch.

### 3.5 Erinnerungen und Benachrichtigungen

- **Discord-Direktnachrichten:** Erinnerungen, die Einladung, einen offenen Tag nachzutragen, Hinweise zu Pausen und Lücken sowie die Wochenübersicht. Die Nachrichten laufen über Discord (siehe 6.1).
- **Web-Push (Benachrichtigungen im Browser):** Wenn du sie einschaltest, speichert Ember die Adresse (Endpunkt), die dein Browser beim Push-Dienst bekommt, zwei Schlüssel für die Verschlüsselung und den Zeitpunkt, zu dem du das Abo zuletzt gespeichert hast. Die Nachricht ist verschlüsselt. Standardmäßig nennt sie keinen Habit-Namen, weil sie auf dem Sperrbildschirm erscheinen kann.
- **Android-App:** Erinnerungen plant die App auf deinem Gerät, und zwar bis zu 14 Tage im Voraus, damit sie auch ohne Internet kommen. Das Widget auf dem Startbildschirm zeigt deine heutigen Habits. Beim Abmelden leert die App beides. [PRÜFEN: Die App ist noch nicht veröffentlicht. Die Build-Konfiguration enthält das Google-Services-Plugin, die App nutzt aber kein Firebase-Messaging. Vor der Veröffentlichung prüfen, dass kein Google-Push für Ember aktiv ist.]

### 3.6 Daten, die Ember nur kurz verwendet

- **Dein Discord-Anzeigename**, wenn du mit `/habit share` eine Streak-Karte in einem Kanal postest. Der Name steht dann auf der Karte. Ember speichert ihn nicht.
- **Technische Angaben zu jeder Discord-Interaktion**, zum Beispiel aus welchem Server oder Kanal ein Befehl kommt. Ember nutzt sie nur, um zu antworten. Gespeichert wird davon nur die Server-ID bei einem Check-in.
- **Deine IP-Adresse:** Ember nutzt sie im Arbeitsspeicher, um zu viele Anfragen abzuwehren (Ratenbegrenzung). Sie wird nicht in der Datenbank gespeichert. [PRÜFEN: Zugriffsprotokolle des Servers oder eines Reverse-Proxys können IP-Adressen enthalten. Speicherdauer festlegen.]

### 3.7 Technische Protokolle (Logs)

Die Dienste schreiben technische Protokolle, zum Beispiel wenn eine Erinnerung nicht zugestellt werden kann oder ein Fehler auftritt. Darin stehen Nutzer-IDs (intern und Discord-Nutzer-IDs), IDs von Push-Abos, interne Nummern von Habits, Zeitpunkte, Fehlermeldungen und Stack-Traces (die Abfolge der Programmteile bei einem Fehler). Habit-Namen stehen dort nicht. E-Mail-Adressen stehen dort nicht; bei E-Mails steht nur die Domain des Empfängers. Die Protokolle dienen nur dazu, Fehler zu finden und den Betrieb sicher zu halten. Sie werden nach Größe rotiert: pro Dienst bleiben höchstens drei Dateien mit je 10 MB, ältere Einträge werden dabei überschrieben. [PRÜFEN: Feste Löschfrist für Protokolle festlegen, siehe docs/legal/README.md.]

### 3.8 Cookies und Speicher im Browser und in der App

Ember setzt keine Cookies für Werbung oder Tracking. Diese Cookies sind technisch notwendig, damit Anmeldung und Schutz funktionieren:

| Name | Zweck | Dauer |
|---|---|---|
| `__Host-Ember` | Hält dich angemeldet. Nur über HTTPS, für JavaScript nicht lesbar. | Bis du den Browser schließt. Mit „Stay signed in“ und bei jeder Anmeldung mit Discord 14 Tage, bei jeder Nutzung verlängert. |
| `XSRF-TOKEN` | Schutz vor Anfragen, die andere Seiten in deinem Namen senden. | Sitzung |
| ASP.NET-Schutz-Cookie für Formulare | Schutz vor gefälschten Anfragen. | Sitzung |
| `Identity.External` und Cookies des Discord-Anmeldevorgangs | Nur während der Anmeldung mit Discord. | Minuten |
| `Identity.TwoFactorUserId` | Zwischenschritt bei der Zwei-Faktor-Anmeldung. | Minuten |
| `__Secure-ember.merge` | Hält einen angefragten Kontoabgleich mit Discord für 15 Minuten. | 15 Minuten |

Außerdem speichern die Web-App und die Android-App einige Dinge auf dem Gerät. Die Liste zeigt, was wo liegt und wann es weg ist:

| Wo | Name | Was drin steht | Wann es gelöscht wird |
|---|---|---|---|
| Browser, Local Storage | `ember.mode` | Ob du mit oder ohne Konto nutzt | Wenn du den Modus wechselst oder die Website-Daten löschst |
| Browser, Local Storage | `ember.theme`, `ember.accountTheme` | Dein gewähltes Design und das Design, das dein Konto zuletzt hatte | Beim Abmelden oder wenn du die Website-Daten löschst |
| Browser, Local Storage | `ember.colorScheme` | Hell, dunkel oder System. Nur auf diesem Gerät, nicht im Konto | Wenn du „System“ wählst oder die Website-Daten löschst |
| Browser, Local Storage | `ember.signupEmail` | E-Mail-Adresse aus der Anmeldung, bis die Bestätigung abgeschlossen ist | Nach der Bestätigung, beim Abmelden, spätestens nach einem Tag |
| Browser, Local Storage | `ember.staySignedIn` | Kennung deines Kontos. Nur, wenn du bei der Anmeldung mit E-Mail und Passwort „Stay signed in“ gewählt hast | Beim Abmelden |
| Browser, Local Storage | `ember.offlineMe` | Kopie deines Kontostands: E-Mail-Adresse, Zeitzone, Design, Stand der Einwilligung und des Tagebuchs. Nur mit „Stay signed in“ | Beim Abmelden oder wenn die Sitzung abläuft. Die Kopie wird nur am selben Tag genutzt |
| Browser, Session Storage | `ember.preloadReload` | Zeitpunkt des letzten Neuladens nach einem App-Update | Am Ende der Browser-Sitzung |
| Browser, IndexedDB `ember-device` | Speicher `cache` | Kopie deiner Habit-Liste. Nur mit „Stay signed in“ | Beim Abmelden oder wenn die Sitzung abläuft |
| Browser, IndexedDB `ember-device` | Speicher `edits` | Änderungen, die du offline gemacht hast und noch nicht gesendet sind | Sobald sie gesendet sind. Beim Abmelden werden die offenen Änderungen verworfen |
| Browser, IndexedDB `ember-journal` | Speicher `keys` | Tagebuchschlüssel, nur mit „Remember on this device“. Für JavaScript nicht auslesbar | Beim Abmelden, beim Ausschalten des Tagebuchs oder wenn du ihn auf diesem Gerät vergisst |
| Browser, IndexedDB `ember-journal` | Speicher `held` | Tagebuch-Änderungen, die warten, weil das Tagebuch gerade gesperrt ist. Sie liegen dort unverschlüsselt | Sobald sie übertragen sind, beim Abmelden |
| Android-App, Local Storage | `ember.reminderPlanned` | Prüfsumme des 14-Tage-Erinnerungsplans | Beim Abmelden und wenn der Plan neu geschrieben wird |
| Android-App, Local Storage | `ember.reminderIssued` | Erinnerungen, die schon ausgelöst wurden: Konto-Kennung, Habit-Nummer und Datum | Beim Abmelden |
| Android-App, Local Storage | `ember.reminderNames` | Einstellung „Show habit names in reminders“ (aus, wenn nicht gewählt) | Beim Abmelden, dann wieder aus |
| Android-App, Widget | Heutige und morgige Habits für das Widget | Im Speicher, den nur die App liest | Beim Abmelden |
| Android-App, sicherer Speicher (Keystore) | Anmeldetoken und, falls gemerkt, der Tagebuchschlüssel | Anmeldung und Tagebuch | Beim Abmelden |

Beim Abmelden meldet die Web-App das Gerät beim Server ab und entfernt das Push-Abo dieses Geräts. Die Speicherung im Browser und in der App ist für Anmeldung, Schutz und die Funktionen nötig, die du nutzt. Eine Einwilligung dafür brauchen wir nach § 25 Abs. 2 Nr. 2 TDDDG nicht. [PRÜFEN: Einstufung der Einstellungen (Design, Modus, Namen in Erinnerungen) nach § 25 TDDDG bestätigen lassen.]

### 3.9 Ohne Konto: Daten nur auf dem Gerät

Wenn du Ember ohne Konto nutzt, bleiben alle Daten auf deinem Gerät: Habits, Check-ins, Tiefs, Routinen, Tagesnotizen, Stimmungen und Einstellungen. Sie gehen nicht an den Server, nicht an Discord und nicht an Push-Dienste. Der Browser oder das Betriebssystem kann sie löschen, zum Beispiel wenn du die Website-Daten entfernst, die App deinstallierst oder Safari eine Website nach sieben Tagen ohne Besuch aufräumt. Mit „Export backup“ speicherst du eine Datei mit deinen Daten.

Legst du später ein Konto an, lädt die App deine Daten hoch. Die lokale Kopie löscht sie erst, wenn alle Schritte erfolgreich waren.

### 3.10 Was Ember nicht verarbeitet

- Nachrichteninhalte aus Discord. Der Bot liest keine Nachrichten mit und nutzt keine privilegierten Gateway-Intents.
- Mitgliederlisten, Online-Status und Freundeslisten.
- Standortdaten, Kontakte, Telefonnummern und Zahlungsdaten. Ember hat keine Bezahlfunktion.
- Werbe-Kennungen und Geräte-Fingerabdrücke.

## 4. Gesundheitsdaten (Art. 9 DSGVO)

Viele Habits haben mit Gesundheit zu tun, zum Beispiel „Medikamente nehmen“, „Schlafen“ oder „Sport“. Ember bietet einige davon sogar als Vorlage an. Aus Habit-Namen, Check-ins, Tiefs, Tagesnotizen und Stimmungen lässt sich deshalb unter Umständen etwas über deine Gesundheit ablesen. Solche Daten sind nach Art. 9 DSGVO besonders geschützt.

Wir behandeln deshalb **alle** Habit-Namen, Check-ins, Tiefs, Tagesnotizen und Stimmungen so, als könnten sie Gesundheitsdaten sein. Ember speichert sie nur mit deiner **ausdrücklichen Einwilligung** (Art. 9 Abs. 2 lit. a DSGVO). Routinen-Namen, das Umbenennen von Habits und Push-Abos brauchen bisher keine Einwilligung. [PRÜFEN: Routinen-Namen und das Umbenennen von Habits unter die Einwilligung stellen oder als Ausnahme begründen. Entscheidung offen, siehe docs/legal/README.md.]

### So fragt Ember nach deiner Einwilligung

- **Neue Nutzer:** Bevor du dein erstes Habit anlegst (auch aus einer Vorlage), ein Tief, eine Tagesnotiz oder eine eigene Stimmung speicherst oder Daten importierst, fragt Ember dich, ob das für dich in Ordnung ist. Im Discord-Bot antwortest du mit den Schaltflächen „I agree“ oder „No thanks“. In der Web-App und der App ist es eine eigene Seite mit „I agree“ und „Not now“. Die Texte dieser Abfrage sind derzeit englisch. [PRÜFEN: deutsche Fassung, siehe docs/legal/README.md.] Erst nach deiner Zustimmung speichert Ember diese Daten.
- **Bestehende Nutzer:** Wenn du Ember schon vor der Einwilligung genutzt hast, fragt die Web-App dich einmal pro Sitzung und der Discord-Bot höchstens einmal am Tag. Bis du antwortest, bleiben deine vorhandenen Habits und Check-ins nutzbar und die Erinnerungen laufen weiter. Neue Habits, Tiefs, Tagesnotizen und Stimmungen gehen erst nach deiner Zustimmung. [PRÜFEN: Darf Ember bestehende Gesundheitsdaten ohne Einwilligung weiter verarbeiten, solange du nicht geantwortet hast? Entscheidung offen, siehe docs/legal/README.md.]
- **Wenn du „No thanks“ wählst:** Ember speichert keine Einwilligung und legt nichts Neues an, wofür sie fehlt. Der Discord-Bot fragt dich 30 Tage lang nicht von sich aus. Die Web-App kennt diese Pause nicht und fragt bei der nächsten Sitzung wieder. Was schon da ist, bleibt, bis du entscheidest. Der Bot bietet dir dann an, deine Daten zu löschen.
- **Wenn sich diese Erklärung ändert:** Mit Version 2026-11 fragt Ember alle Nutzer noch einmal, auch wenn sie vorher zugestimmt haben. Bei einer weiteren neuen Version geschieht das auf dieselbe Weise.

Wenn du zustimmst, speichert Ember den Zeitpunkt und die Version dieser Erklärung (Abschnitt 3.1).

### Tagesnotizen, Stimmungen und Tiefs sind privat

Tagesnotizen und Stimmungen erscheinen nie im Discord-Bot, in Benachrichtigungen, in der Wochenübersicht oder im Export des Discord-Bots (`/export`). Ein Tief erscheint auf einer Streak-Karte, die du mit `/habit share` postest, nur als normale Lücke.

### Widerruf

Du kannst deine Einwilligung jederzeit widerrufen (Art. 7 Abs. 3 DSGVO). Ohne Habit-Namen und Check-ins kann Ember seinen Dienst nicht erbringen. Deshalb ist das Löschen des Kontos derzeit der einzige Weg, die Einwilligung zu widerrufen: in der Web-App und der App unter „Delete your account“ in den Einstellungen oder im Discord-Bot mit `/privacy delete`. Das löscht alles sofort auf dem Server (zu den Kopien auf anderen Geräten siehe Abschnitt 9). [PRÜFEN: Ob ein eigener Widerruf ohne Kontolöschung nötig ist.] Was bis zum Widerruf passiert ist, bleibt rechtmäßig.

## 5. Zwecke und Rechtsgrundlagen

| Zweck | Rechtsgrundlage |
|---|---|
| Konto, Anmeldung, Sitzungen, Sperre nach Fehlversuchen, Bestätigung der E-Mail-Adresse, Zurücksetzen des Passworts, Zwei-Faktor-Anmeldung, Verknüpfung mit Discord | Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag, siehe Nutzungsbedingungen). Für die Sicherheit des Kontos zusätzlich Art. 6 Abs. 1 lit. f DSGVO. |
| Habits, Check-ins, Tiefs, Gnadentage, Streaks, Statistiken, Erinnerungen, Wochenübersicht, Export und Löschung | Art. 6 Abs. 1 lit. b DSGVO. Für Habit-Namen, Check-ins und Tiefs zusätzlich Art. 9 Abs. 2 lit. a DSGVO (Einwilligung). |
| Tagesnotizen und Stimmungen | Art. 6 Abs. 1 lit. b DSGVO und Art. 9 Abs. 2 lit. a DSGVO (Einwilligung). |
| Routinen, Umbenennen von Habits, Push-Abos | Art. 6 Abs. 1 lit. b DSGVO. Keine Einwilligung bisher. [PRÜFEN: siehe Abschnitt 4.] |
| Erinnerungen über Discord, Web-Push und lokal in der App | Art. 6 Abs. 1 lit. b DSGVO. Jeden Kanal schaltest du selbst ein. |
| E-Mails zur Bestätigung und zum Zurücksetzen des Passworts | Art. 6 Abs. 1 lit. b DSGVO |
| Einwilligungsnachweis | Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit Art. 7 Abs. 1 DSGVO |
| Technische Protokolle, Ratenbegrenzung, Fehlersuche, Sicherheit, Backups | Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist ein sicherer, stabiler Betrieb und dass deine Daten nach einem technischen Ausfall nicht verloren gehen. |
| Cookies und Speicher im Browser und in der App (Abschnitt 3.8) | § 25 Abs. 2 Nr. 2 TDDDG. Die Verarbeitung der Daten selbst richtet sich nach den Zeilen oben. |

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

Bestätigungs- und Passwort-E-Mails verschickt Ember über den Dienst **Resend** (Resend, Inc., USA) als Auftragsverarbeiter nach Art. 28 DSGVO. Übermittelt werden die Empfängeradresse, der Betreff und der Text. Der Text enthält einen Code und einen Link für die Bestätigung oder das Zurücksetzen des Passworts. Öffnungs- und Klickverfolgung sind für diese Mails ausgeschaltet. Resend verarbeitet Daten auch in den USA; die Übermittlung stützt sich auf Standardvertragsklauseln im Auftragsverarbeitungsvertrag von Resend. [PRÜFEN: Auftragsverarbeitungsvertrag mit Resend, Verarbeitungsregion (EU gewählt?), Zertifizierung im Data Privacy Framework, Speicherdauer bei Resend; Öffnungs- und Klickverfolgung in Resend für ember-glow.app aus.]

### 6.4 Push-Dienste der Browser

Wenn du Web-Push einschaltest, schickt Ember die Nachricht über den Push-Dienst deines Browsers. Je nach Browser ist das Google (Chrome und andere Chromium-Browser, auch auf Android), Mozilla (Firefox), Apple (Safari, auch für installierte Web-Apps auf dem iPhone) oder Microsoft (Edge unter Windows). Der Push-Dienst sieht die Adresse deines Browser-Abos und den Zeitpunkt der Nachricht. Den Inhalt kann er nicht lesen, weil Ember ihn verschlüsselt. Die Push-Dienste verarbeiten diese Daten nach ihren eigenen Datenschutzregeln. [PRÜFEN: Drittlandübermittlung der Push-Dienste und ob sie als eigene Verantwortliche gelten.]

### 6.5 Sonst niemand

Außer an die oben genannten Dienste und an den Speicher für die verschlüsselten Backups (Abschnitt 7) geben wir deine Daten an niemanden weiter. Wir verkaufen sie nicht und nutzen sie nicht für Werbung. Ember setzt keine Analyse-, Tracking- oder KI-Dienste ein. Schriften und Skripte lädt Ember nicht von fremden Servern. Eine Weitergabe an Behörden erfolgt nur, wenn ein Gesetz es verlangt.

## 7. Wie lange speichert Ember deine Daten?

- **Dein Konto und deine Daten** bleiben gespeichert, bis du sie löschst. Einzelne Habits, Routinen, Check-ins, Tiefs, Tagesnotizen und Stimmungen kannst du in der App oder im Bot entfernen. Die Kontolöschung entfernt alles sofort (Abschnitt 9).
- **Konten, deren E-Mail-Adresse nie bestätigt wurde,** werden nach 7 Tagen automatisch gelöscht, wenn sie noch keine Daten und keine Discord-Anmeldung haben.
- **Anmeldesitzungen:** Eine Sitzung läuft 14 Tage nach der letzten Nutzung ab. Abgelaufene Sitzungen löscht Ember einmal am Tag. Pro Konto bleiben höchstens 50 Sitzungen, bei einer neuen Anmeldung endet dann die älteste.
- **Erinnerungen in Discord:** Der Eintrag bleibt, bis die Nachricht geschlossen oder ersetzt wird. Danach wird er gelöscht.
- **Web-Push-Abos:** bis du sie abmeldest, Benachrichtigungen ausschaltest, der Push-Dienst das Abo als ungültig meldet oder dein Konto gelöscht wird. Beim Abmelden entfernt die Web-App das Abo.
- **Technische Protokolle:** siehe Abschnitt 3.7.
- **Backups:** Die Datenbank wird jede Nacht gesichert. Wir behalten die Sicherungen der letzten 7 Tage und eine Sicherung pro Woche für die letzten 4 Wochen, ältere werden gelöscht. Eine Kopie liegt Ende-zu-Ende verschlüsselt bei Proton Drive (Proton AG, Schweiz; für die Schweiz gilt ein Angemessenheitsbeschluss der EU-Kommission). Bis zur Löschung können gelöschte Daten also bis zu etwa 5 Wochen in einem Backup stehen. Backups nutzen wir nur, um den Betrieb nach einem technischen Ausfall wiederherzustellen. Müssen wir ein Backup einspielen, löschen wir die seitdem gelöschten Konten und Daten danach erneut. [PRÜFEN: Backup-Ablauf, Proton Drive und Verschlüsselung sind nicht im Repository belegt. Vor dem Start prüfen, siehe docs/legal/README.md.]
- **Daten bei Discord:** nach den Regeln von Discord.
- **Ohne Konto:** auf dem Gerät, bis du sie löschst oder Browser beziehungsweise Betriebssystem sie entfernen.

## 8. Wie schützen wir deine Daten?

- **Datensparsamkeit:** Ember speichert nur die oben genannten Daten. Check-ins haben nur ein Datum, keine Uhrzeit.
- **Kein Mitlesen von Chats:** Der Bot liest keine Nachrichten mit.
- **Verschlüsselte Verbindung:** Web-App und API sind nur über HTTPS erreichbar.
- **Passwörter:** Ember speichert nur einen Hash. Nach fünf Fehlversuchen ist die Anmeldung 15 Minuten gesperrt. Zusätzlich begrenzt Ember die Anzahl der Anfragen.
- **Sitzungen:** Abmelden beendet nur die Sitzung auf diesem Gerät. „Sign out everywhere“ in den Einstellungen beendet alle Sitzungen. Das Zurücksetzen des Passworts beendet alle Sitzungen. Das Ein- oder Ausschalten der Zwei-Faktor-Anmeldung, das Verknüpfen oder Trennen von Discord und das Zusammenführen von Konten beenden die anderen Sitzungen.
- **Zwei-Faktor-Anmeldung:** optional mit einer Authenticator-App und Wiederherstellungscodes.
- **Privates Tagebuch:** Ende-zu-Ende verschlüsselt (Abschnitt 3.4).
- **Privat als Standard:** Antworten auf deine Befehle sieht in der Regel nur du. Öffentlich wird nur, was du selbst postest (`/habit share`).
- **Zugriff:** Nur der Verantwortliche hat Zugriff auf den Server und die Datenbank.
- **Löschen auf Knopfdruck:** Die Kontolöschung entfernt alles auf dem Server sofort. Kopien auf anderen Geräten siehe Abschnitt 9.

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
| Alle deine Daten sehen oder mitnehmen | Web-App oder App: Einstellungen, Abschnitt „Your data“, Export als JSON oder CSV. Der Export enthält deine Einstellungen (mit dem Einwilligungsnachweis), die E-Mail-Adresse, die Discord-Nutzer-ID, alle Habits, Routinen, Check-ins, Tiefs, Tagesnotizen, Stimmungen, die Adressen deiner Push-Abos (ohne Schlüssel) und den verschlüsselten Tagebuchschlüssel. Ein verschlüsseltes Tagebuch bleibt in der Datei verschlüsselt. Die Web-App bietet außerdem einen entschlüsselten Export deines Tagebuchs an. Discord: `/export` enthält nur Einstellungen, Habits, Check-ins, Tiefs und Routinen. Den vollständigen Export gibt es in der Web-App. [PRÜFEN: Nicht im Export sind Anmeldesitzungen, die Zahl der Anmeldeversuche, das Ende einer Sperre und die Erinnerungseinträge in Discord. Art. 15 verlangt Auskunft über alle Daten. Export ergänzen oder auf Anfrage nachreichen, siehe docs/legal/README.md.] |
| Alles löschen | Web-App oder App: Einstellungen, „Delete your account“. Mit Passwort und Eingabe von DELETE. Bei Konten ohne Passwort nur mit DELETE. Discord: `/privacy delete`, dann „Delete everything“. Das lässt sich nicht rückgängig machen. Exportiere vorher, wenn du deine Daten behalten möchtest. Auf anderen Geräten bleiben lokale Kopien (Abschnitt 3.8), bis das Gerät den Server das nächste Mal erreicht. Dann meldet die App dich ab und löscht die Kopien. Erinnerungen in Discord bleiben als Nachrichten stehen, ihre Schaltflächen führen aber ins Leere. |
| Ein Habit löschen oder umbenennen, die Häufigkeit oder die Erinnerung ändern | Discord: `/habit delete`, `/habit edit`, `/habit frequency`. Web-App: Habit öffnen, dann „Edit habit“ oder „Delete habit“. |
| Einen Check-in korrigieren, nachtragen oder ein Tief setzen oder entfernen | Discord: `/habit history`. Web-App: Tab „History“, dann das Habit. |
| Eine Tagesnotiz oder Stimmung ändern | Web-App oder App (Tagebuch). |
| Discord trennen | Web-App oder App: Einstellungen, „Unlink Discord“. Das geht nur, wenn du ein Passwort und eine bestätigte E-Mail-Adresse hast, sonst könntest du dich nicht mehr anmelden. |

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

Du musst Ember keine Daten geben. Ohne ein Konto mit E-Mail-Adresse oder Discord-Anmeldung, ohne Habit-Namen und Check-ins kann Ember auf dem Server aber nicht arbeiten. Du kannst Ember dann vollständig auf deinem Gerät nutzen (Abschnitt 3.9). Zeitzone, Erinnerungen, Gnadentage, Tiefs, Tagesnotizen und Stimmungen sind freiwillig. Die Einwilligung (Abschnitt 4) brauchst du, um Habits anzulegen und Tiefe, Tagesnotizen, Stimmungen oder importierte Daten zu speichern.

## 12. Änderungen

Wenn sich Ember ändert, passen wir diese Erklärung an. Das Datum oben zeigt die aktuelle Fassung. Über wichtige Änderungen informieren wir dich in Ember. Brauchen wir für etwas Neues deine Einwilligung, fragen wir dich vorher, wie in Abschnitt 4 beschrieben.
