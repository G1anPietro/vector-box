#!/usr/bin/env python3
"""Generates the static error pages in public/errors/ (run after editing the texts).
Static on purpose: they must work when PHP or Node are down. No inline CSS/JS (CSP)."""
import html, os

PAGES = {
 400: ("BAD_REQUEST", "Richiesta non valida", "Il server non ha capito la richiesta. Ricarica la pagina o torna alla home.", False),
 401: ("AUTH_REQUIRED", "Accesso richiesto", "Devi accedere per vedere questa pagina.", False),
 403: ("ACCESS_DENIED", "Accesso negato", "Non hai il permesso di aprire questa risorsa.", False),
 404: ("SIGNAL_LOST", "Pagina non trovata", "Questo indirizzo non esiste, o è stato spostato.", False),
 405: ("METHOD_REFUSED", "Metodo non consentito", "Questa risorsa non accetta questo tipo di richiesta.", False),
 408: ("LINK_TIMEOUT", "Richiesta scaduta", "La connessione è stata troppo lenta. Riprova.", False),
 413: ("PAYLOAD_TOO_BIG", "File troppo grande", "Il file supera il limite consentito dal server.", False),
 414: ("URI_TOO_LONG", "Indirizzo troppo lungo", "L'indirizzo richiesto è troppo lungo.", False),
 429: ("RATE_LIMITED", "Troppe richieste", "Stai andando troppo veloce. Aspetta un minuto e riprova.", False),
 500: ("CORE_FAULT", "Errore interno", "Qualcosa si è rotto dalla nostra parte. Non è colpa tua: riprova tra poco.", True),
 502: ("BAD_GATEWAY", "Servizio non raggiungibile", "Una parte del sistema non risponde (forse si sta riavviando). Riprovo da solo.", True),
 503: ("SYSTEM_OFFLINE", "Servizio non disponibile", "Il sito è in manutenzione o sovraccarico. Riprovo da solo.", True),
 504: ("GATEWAY_TIMEOUT", "Il server non risponde", "Il server ci sta mettendo troppo. Riprovo da solo.", True),
}

TEMPLATE = """<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{code} // {title}</title>
<link rel="stylesheet" href="/errors/errors.css">
</head>
<body{body_attr}>
<main class="err">
  <div class="err-tag">// {tag}</div>
  <h1 class="err-code" data-text="{code}">{code}</h1>
  <h2 class="err-title">{title}</h2>
  <p class="err-text">{text}</p>
{retry}  <div class="err-actions">
    <a class="err-btn" href="/">// RETURN_HOME</a>
    <a class="err-btn err-btn-alt" href="#" id="err-back">// GO_BACK</a>
  </div>
  <p class="err-foot">vector-box · error {code}</p>
</main>
<script src="/errors/errors.js"></script>
</body>
</html>
"""
RETRY = '  <p class="err-retry" id="err-retry" hidden>Nuovo tentativo tra <b id="err-count">15</b>s</p>\n'

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "errors")
for code, (tag, title, text, retry) in PAGES.items():
    out = TEMPLATE.format(code=code, tag=tag, title=html.escape(title), text=html.escape(text),
                          retry=RETRY if retry else "", body_attr=' data-retry="1"' if retry else "")
    with open(os.path.join(here, f"{code}.html"), "w", encoding="utf-8") as f:
        f.write(out)
print(f"{len(PAGES)} pages written")
