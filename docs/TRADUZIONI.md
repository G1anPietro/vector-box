# Traduzioni (EN di default, IT in Italia)

Il sito parla **inglese** a tutti, e **italiano** a chi arriva dall'Italia o sceglie l'italiano. Regole di scelta (una sola, in `detectLang()` in
`public/api/helpers.php`): 1) scelta esplicita (`?lang=it|en`, poi il cookie `vb_lang`); 2) visitatore dall'Italia (paese dall'IP, database locale)
→ italiano; 3) lingua del browser, se è una che abbiamo; 4) inglese.

## Come si traduce una cosa

| Dove | Come |
|---|---|
| Pagina **PHP** | `pageLang()` dà `'en'` o `'it'`; `tr(['en' => '…', 'it' => '…'])` sceglie il testo. Blocchi lunghi: `<?php if (pageLang() === 'it'): ?> … <?php else: ?> … <?php endif; ?>`. `<html lang="<?= pageLang() ?>">`. Le pagine esistenti (giochi, privacy, progetto, sicurezza…) sono il modello. |
| Pagina **.html statica** | Il testo scritto nell'HTML è **inglese**. Nel `<head>` (senza `defer`): `<script src="../js/i18n.js?v=1"></script>`. Sugli elementi `data-i18n="chiave"`; per gli attributi `data-i18n-attr="aria-label:chiave;title:altra"`; `<title data-i18n="title">` e `<meta name="description" data-i18n-attr="content:desc">` funzionano. I testi italiani: `VBI18N.add('it', { chiave: 'testo' })` (di solito in cima al JS della pagina). Aggiungi `data-lang-switch` su `<html>` per avere il selettore EN \| IT. |
| Testi creati da **JavaScript** | `VBLang.t('chiave', { n: 3 })` (`{n}` nel testo viene sostituito). Registra l'inglese con `VBI18N.add('en', {...})` e l'italiano con `VBI18N.add('it', {...})`. Ascolta il cambio lingua con `addEventListener('vb-lang', …)` se la pagina deve ridisegnarsi. |
| Messaggi delle **API** | Sono in inglese e restano così (l'interfaccia li mostra come sono o li traduce con il campo `code`). |

Solo `textContent` o `setAttribute`: mai `innerHTML` con testo tradotto o dell'utente. Una chiave mancante in italiano ricade sull'inglese, poi sulla chiave stessa.

## Regole di qualità
- Inglese **naturale**, non parola per parola; stesso tono (scherzoso dove lo è). Termini della scuola italiana (*verifica*, *interrogazione*, *registro*) si spiegano alla prima occorrenza.
- Non tradurre contenuti degli utenti, nomi propri, comandi del terminale, codici.
- Chiavi stabili e descrittive (`pause_title`, non `t17`). Niente testo duplicato sotto chiavi diverse.
- Controlla che **nessuna** frase italiana resti nella pagina in inglese (e viceversa): vedi `tests/lang-helpers.js` (`looksItalian()`).
- Prova nel browser: `?lang=en` e `?lang=it` (il cookie ricorda la scelta; per tornare alla scelta automatica cancella il cookie `vb_lang`).

## Aggiungere una lingua
Aggiungi il codice a `SITE_LANGS` (`public/api/helpers.php`) e a `SUPPORTED` (`public/js/i18n.js`), poi traduci i dizionari. Spia, Lupus, Cucù e Non ho mai hanno già 5 lingue (it, en, es, fr, de) nei loro `i18n.js`.
