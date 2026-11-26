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
