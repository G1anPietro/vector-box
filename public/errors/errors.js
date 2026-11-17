// The Italian texts of the error pages (the English ones are written in the HTML; see js/i18n.js).
VBI18N.add('it', {
  home: '// TORNA_ALLA_HOME', back: '// INDIETRO', retry: 'Nuovo tentativo tra',
  e400_page: '400 // Richiesta non valida', e400_title: 'Richiesta non valida', e400_text: 'Il server non ha capito la richiesta. Ricarica la pagina o torna alla home.',
  e401_page: '401 // Accesso richiesto', e401_title: 'Accesso richiesto', e401_text: 'Devi accedere per vedere questa pagina.',
  e403_page: '403 // Accesso negato', e403_title: 'Accesso negato', e403_text: 'Non hai il permesso di aprire questa risorsa.',
  e404_page: '404 // Pagina non trovata', e404_title: 'Pagina non trovata', e404_text: 'Questo indirizzo non esiste, o è stato spostato.',
  e405_page: '405 // Metodo non consentito', e405_title: 'Metodo non consentito', e405_text: 'Questa risorsa non accetta questo tipo di richiesta.',
  e408_page: '408 // Richiesta scaduta', e408_title: 'Richiesta scaduta', e408_text: 'La connessione è stata troppo lenta. Riprova.',
  e413_page: '413 // File troppo grande', e413_title: 'File troppo grande', e413_text: 'Il file supera il limite consentito dal server.',
  e414_page: '414 // Indirizzo troppo lungo', e414_title: 'Indirizzo troppo lungo', e414_text: 'L\'indirizzo richiesto è troppo lungo.',
  e429_page: '429 // Troppe richieste', e429_title: 'Troppe richieste', e429_text: 'Stai andando troppo veloce. Aspetta un minuto e riprova.',
  e500_page: '500 // Errore interno', e500_title: 'Errore interno', e500_text: 'Qualcosa si è rotto dalla nostra parte. Non è colpa tua: riprova tra poco.',
  e502_page: '502 // Servizio non raggiungibile', e502_title: 'Servizio non raggiungibile', e502_text: 'Una parte del sistema non risponde (forse si sta riavviando). Riprovo da solo.',
  e503_page: '503 // Servizio non disponibile', e503_title: 'Servizio non disponibile', e503_text: 'Il sito è in manutenzione o sovraccarico. Riprovo da solo.',
  e504_page: '504 // Il server non risponde', e504_title: 'Il server non risponde', e504_text: 'Il server ci sta mettendo troppo. Riprovo da solo.',
});
// Auto-retry for 5xx pages (<body data-retry="1">); hides "go back" when there is no history.
(function () {
  var back = document.getElementById('err-back');
  if (back) {
    back.addEventListener('click', function (e) { e.preventDefault(); history.back(); });
    if (history.length < 2) back.hidden = true;
  }
  if (!document.body.hasAttribute('data-retry')) return;
  var box = document.getElementById('err-retry'), out = document.getElementById('err-count');
  if (!box || !out) return;
  var left = 15;
  box.hidden = false;
  var t = setInterval(function () {
    left--; out.textContent = String(left);
    if (left <= 0) { clearInterval(t); location.reload(); }
  }, 1000);
})();
