# Posta personale (@talvera.site)

L'admin crea gli indirizzi in **Posta → Indirizzi** (parte prima della @ + nome utente: la persona riceve il permesso di aprire la posta).
Scrivere tra indirizzi del sito funziona subito. Verso l'esterno (Gmail...) e dall'esterno servono due cose:

## 1. Inviare verso fuori (Resend)
`.env`: `MAIL_DRIVER=http`, `MAIL_HTTP_URL=https://api.resend.com/emails`, `MAIL_API_KEY=...`, `MAIL_FROM="vector-box <no-reply@talvera.site>"`.
In Resend: aggiungere il dominio `talvera.site` e inserire in Cloudflare i record DNS (SPF, DKIM) che Resend mostra. Fino ad allora l'invio esterno risponde "non ancora attivo".
Verso l'esterno scrive solo l'admin (gli altri account possono scrivere solo agli indirizzi del sito). Limiti: 40 messaggi al giorno, più `MAIL_DAILY_LIMIT` per tutto il sito.

## 2. Ricevere da fuori (Cloudflare Email Routing + Worker)
`.env`: `MAIL_INBOUND_SECRET=<una stringa lunga a caso>` (senza, l'endpoint risponde 503). `MAIL_DOMAIN=talvera.site` è il valore predefinito.
Cloudflare → Email → Email Routing → abilitare, poi **Routing rules → Catch-all → Send to a Worker**. Worker (Workers & Pages → Create → Hello World), con la variabile segreta `INBOUND_SECRET` uguale a quella del `.env`:

```js
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    // testo semplice: prende la parte dopo la prima riga vuota (le e-mail con allegati/HTML vengono mostrate com'è: shortcut)
    const text = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n').slice(0, 50000);
    const r = await fetch('https://talvera.site/api/mail_inbound.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.INBOUND_SECRET },
      body: JSON.stringify({ to: message.to, from: message.from, subject: message.headers.get('subject') || '', text }),
    });
    if (r.status === 404) message.setReject('No such address');   // indirizzo inesistente: rimbalza
  },
};
```
Limite noto: i messaggi MIME (HTML, allegati, codifica quoted-printable) compaiono grezzi; un parser (postal-mime) si può aggiungere al Worker quando serve.

## Stato (26/11)
Ricezione attiva: Email Routing acceso su `talvera.site`, catch-all verso il Worker `talvera-mail-in` (codice in `~/talvera-worker/src/index.js` sul portatile, non nel repo; usa `postal-mime` per leggere il testo, variabile segreta `INBOUND_SECRET` = `MAIL_INBOUND_SECRET` del `.env`). Un 404 del sito rimbalza il messaggio. Per aggiornarlo: `cd ~/talvera-worker && npx wrangler login && npx wrangler deploy`, poi `npx wrangler logout`.
Invio verso fuori: attivo dal 26/11 con Resend (piano gratuito, regione Irlanda). Dominio `talvera.site` verificato; record DNS su Cloudflare, tutti "DNS only": TXT `resend._domainkey` (DKIM), CNAME `send` e `rsend` verso `*.forge.rmta.net` (non toccano la ricezione, che usa gli MX di Cloudflare sul dominio principale), TXT `_dmarc` con `p=none` (solo monitoraggio). Nel `.env` del server: `MAIL_DRIVER=http`, `MAIL_HTTP_URL=https://api.resend.com/emails`, `MAIL_API_KEY` (chiave "Sending access", si cambia dal pannello Resend → API keys). Il sito spedisce subito quando si preme Invia; scrive fuori solo l'admin.

## Allegati (27/11)
Si allegano file dal pulsante 📎 della finestra di scrittura (fino a 5 file, 10 MB l'uno, 20 MB in tutto) e si scaricano dal messaggio. I byte stanno in `data/mail_files/` (fuori dal web, nomi casuali), le righe in `mail_files` (v67); ogni riga ha il suo file. Spazio per account: 300 MB. I file si scaricano sempre come `application/octet-stream` con `Content-Disposition: attachment`, solo dal proprietario. Si cancellano con il messaggio (cestino → elimina), con l'account e dopo 24 ore se caricati e mai inviati. Nelle bozze gli allegati non si salvano.
In uscita (Resend): `attachments` in base64, max 40 MB per messaggio dopo la codifica. In entrata: il Worker (`~/talvera-worker`) passa fino a 4 MB per file e 8 MB in tutto (poco tempo CPU nel piano gratuito); quello che non entra viene solo nominato in fondo al testo ("[Not saved: …]"). Non c'è scansione antivirus: non aprire file di sconosciuti. La mail temporanea ignora gli allegati.

## Funzioni della casella (27/11, schema v68)

- **Firma** per indirizzo (`mail_addresses.signature`, 500 caratteri, `set_signature`): finisce in fondo ai messaggi nuovi (sopra la citazione nelle risposte); cambiando il mittente si cambia anche la firma. Una firma da sola non è un messaggio: non crea bozze.
- **Cc / Ccn** (`mail_inbox.cc_addr`, `bcc_addr`): fino a 10 destinatari in tutto. Ognuno riceve una copia propria; la copia locale mostra il Cc, mai il Ccn (lo vede solo chi ha inviato). Verso fuori ogni destinatario è un invio separato, quindi fuori non compare l'intestazione Cc.
- **Etichette**: una per messaggio, fra `work personal important later` (`mail_inbox.label`, azione `label`); cartelle `label:<nome>` e un punto colorato nella lista.
- **Ricerca**: cerca in tutte le cartelle tranne il cestino (`folder=all`), anche nei nomi dei file allegati. Usa `LIKE`, non l'indice FTS: basta per una casella personale (100 risultati al massimo).
- **Annulla invio**: "Invia" aspetta 10 secondi, con un tasto Annulla che riapre il messaggio; se la pagina si chiude nel frattempo, parte subito (`fetch` con `keepalive`). Se l'invio fallisce, il messaggio torna nella finestra (o nelle bozze, se se ne sta scrivendo un altro).
- **Bozze automatiche**: 5 secondi dopo l'ultimo tasto (solo dopo una modifica vera). Gli allegati non si salvano nelle bozze.
- **Nuove mail**: ogni 60 secondi la pagina controlla; il titolo della scheda mostra i non letti, la lista si aggiorna e, se il browser lo permette (tasto 🔔), compare una notifica quando la scheda non è in primo piano.
- **Anteprima allegati**: `file&id=N&preview=1` mostra in linea solo PNG, JPEG, GIF, WebP e PDF, riconosciuti dai primi byte (mai dal tipo dichiarato dal mittente); le immagini con `CSP: sandbox`. Tutto il resto, SVG compreso, resta un download.

