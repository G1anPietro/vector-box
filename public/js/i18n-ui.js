// public/js/i18n-ui.js — the texts of the desktop scripts and of the small PHP pages (English first, then Italian). Needs js/i18n.js before it.
// Text that PHP writes itself uses tt() / tr() instead; this file is only for what JavaScript puts on the screen.
VBI18N.add('en', {
    error: 'ERROR', failed: 'Failed', loading: 'Loading...', today: 'Today', warning: 'WARNING', uplink_error: 'Uplink error.',
    lang_unknown: 'unknown language',
    up_sending: 'TRANSMITTING...', up_done: '// TRANSMISSION DELIVERED', up_fail: '// UPLINK FAILURE: TARGET UNREACHABLE', up_btn: 'TRANSMIT MESSAGE',
    gb_empty: 'No signatures yet. Be the first to tag the wall.', gb_remove: 'Remove entry', gb_load_fail: 'Failed to load the wall.',
    gb_signed: 'Signature burned into the wall.', gb_sign_fail: 'Failed to sign.',
    st_online: 'ONLINE', st_offline: 'OFFLINE', st_link: 'LINK', st_uptime: 'UPTIME', st_memory: 'MEMORY', st_services: 'SERVICES', st_up: 'UP', st_down: 'DOWN',
    st_sampled: 'sampled {n}s ago',
    dm_none: 'No conversations yet. Find a user above to start one.', dm_loading: 'loading older messages…', dm_start: 'start of the conversation',
    dm_block: 'BLOCK', dm_unblock: 'UNBLOCK', dm_you_blocked: 'You blocked this user.', dm_cannot: 'You cannot write to this user.',
    dm_confirm_block: 'Block {u}? Neither of you will be able to write to the other.', dm_nouser: 'No user found',
    pk_top: 'TOP PLAYERS // hands won', pk_player: 'PLAYER', pk_won: 'WON', pk_crwon: 'CR WON', pk_nohands: 'No hands recorded yet. Log in and play to get on the board.',
    pk_biggest: 'Your biggest pot: {n} CR', pk_lb_fail: 'Leaderboard unavailable.', pk_room: 'ROOM', pk_stage: 'STAGE', pk_nocards: 'NO CARDS DEALT',
    pk_folded: 'FOLDED', pk_empty: 'TABLE EMPTY. PRESS "SEAT" TO JOIN.', pk_create_fail: 'Failed to create room.',
    tool_err: 'ERROR: INVALID INPUT FOR SELECTED MODE',
    hk_overflow: 'BREACH FAILED: BUFFER OVERFLOW', hk_ok: 'BREACH SUCCESSFUL: ACCESS GRANTED', hk_trace: 'BREACH FAILED: TRACE DETECTED',
    arg_ok: 'DECRYPTION SUCCESSFUL', arg_log1: 'System architecture designed by Denys. All nodes operational under Ubuntu kernel 6.8.0.',
    arg_log2: "Try running 'theme matrix' or 'theme cyberpunk' inside the shell terminal.", arg_enter: 'ENTER PASSPHRASE...', arg_denied: 'ACCESS DENIED: INVALID KEY',
    ad_confirm: 'Delete your account and your data for good? This cannot be undone.', ad_deleting: 'Deleting...',
    ad_done: 'Done: your account and data were deleted. Goodbye!', ad_fail: 'Could not delete the account.', ad_net: 'Network error: try again.',
    ch_online: '● {n} online', ch_typing1: '{u} is typing…', ch_typingn: '{u} are typing…', ch_typing_many: 'several people are typing…',
    ch_delete: 'Delete transmission', ch_send_fail: 'Failed to send message.'
});
VBI18N.add('it', {
    error: 'ERRORE', failed: 'Non riuscito', loading: 'Caricamento...', today: 'Oggi', warning: 'ATTENZIONE', uplink_error: 'Errore di collegamento.',
    lang_unknown: 'lingua sconosciuta',
    up_sending: 'INVIO...', up_done: '// MESSAGGIO CONSEGNATO', up_fail: '// COLLEGAMENTO FALLITO: DESTINAZIONE IRRAGGIUNGIBILE', up_btn: 'INVIA MESSAGGIO',
    gb_empty: 'Ancora nessuna firma. Sii il primo a lasciare un segno sul muro.', gb_remove: 'Rimuovi la firma', gb_load_fail: 'Non riesco a caricare il muro.',
    gb_signed: 'Firma incisa sul muro.', gb_sign_fail: 'Firma non riuscita.',
    st_online: 'ONLINE', st_offline: 'OFFLINE', st_link: 'LINK', st_uptime: 'ATTIVO DA', st_memory: 'MEMORIA', st_services: 'SERVIZI', st_up: 'SU', st_down: 'GIU',
    st_sampled: 'misurato {n}s fa',
    dm_none: 'Ancora nessuna conversazione. Cerca un utente qui sopra per iniziarne una.', dm_loading: 'carico i messaggi precedenti…', dm_start: 'inizio della conversazione',
    dm_block: 'BLOCCA', dm_unblock: 'SBLOCCA', dm_you_blocked: 'Hai bloccato questo utente.', dm_cannot: 'Non puoi scrivere a questo utente.',
    dm_confirm_block: 'Bloccare {u}? Nessuno dei due potrà scrivere all\'altro.', dm_nouser: 'Nessun utente trovato',
    pk_top: 'MIGLIORI GIOCATORI // mani vinte', pk_player: 'GIOCATORE', pk_won: 'VINTE', pk_crwon: 'CR VINTI', pk_nohands: 'Ancora nessuna mano registrata. Accedi e gioca per entrare in classifica.',
    pk_biggest: 'Il tuo piatto più grande: {n} CR', pk_lb_fail: 'Classifica non disponibile.', pk_room: 'STANZA', pk_stage: 'FASE', pk_nocards: 'NESSUNA CARTA SUL TAVOLO',
    pk_folded: 'PASSATO', pk_empty: 'TAVOLO VUOTO. PREMI "SIEDITI" PER ENTRARE.', pk_create_fail: 'Non riesco a creare la stanza.',
    tool_err: 'ERRORE: INPUT NON VALIDO PER LA MODALITÀ SCELTA',
    hk_overflow: 'INTRUSIONE FALLITA: BUFFER PIENO', hk_ok: 'INTRUSIONE RIUSCITA: ACCESSO CONCESSO', hk_trace: 'INTRUSIONE FALLITA: TRACCIATO',
    arg_ok: 'DECIFRATURA RIUSCITA', arg_log1: 'Architettura del sistema progettata da Denys. Tutti i nodi funzionano su Ubuntu, kernel 6.8.0.',
    arg_log2: "Prova a scrivere 'theme matrix' o 'theme cyberpunk' nel terminale.", arg_enter: 'INSERISCI LA CHIAVE...', arg_denied: 'ACCESSO NEGATO: CHIAVE NON VALIDA',
    ad_confirm: 'Eliminare per sempre il tuo account e i tuoi dati? Non si può annullare.', ad_deleting: 'Eliminazione...',
    ad_done: 'Fatto: account e dati eliminati. Ciao!', ad_fail: 'Non sono riuscito a eliminare l\'account.', ad_net: 'Errore di rete: riprova.',
    ch_online: '● {n} online', ch_typing1: '{u} sta scrivendo…', ch_typingn: '{u} stanno scrivendo…', ch_typing_many: 'più persone stanno scrivendo…',
    ch_delete: 'Elimina messaggio', ch_send_fail: 'Invio non riuscito.'
});

// the admin pages: e-mail box (mail.js) and people panel (admin_users.js)
VBI18N.add('en', {
    wrong: 'Something went wrong.',
    mb_sending: 'Sending: {d}', mb_off: 'Sending: OFF (MAIL_DRIVER is empty)', mb_counts: ' · today {a}/{b} · waiting {c} · failed {d}', mb_news: ' · can get news: {a} (supporters {b})',
    mb_nothing: 'Nothing here.', mb_nosubject: '(no subject)', mb_people: '{n} people', mb_readonly: 'This message was sent: it cannot be changed.', mb_saved: 'Draft saved.',
    mb_test: 'Test queued ({n}). Press SEND NOW if no worker runs.', mb_confirm: 'Send this message to {n} people? It cannot be undone.', mb_queued: 'Queued for {n} people.',
    mb_del: 'Delete this draft?', mb_off2: 'Sending is OFF: set MAIL_DRIVER in .env.', mb_sent: 'Sent {a}, waiting {b}.',
    au_people: 'People', au_new7: 'New (7 days)', au_admins: 'Admins', au_banned: 'Banned', au_withmail: 'With e-mail', au_news: 'Want news', au_nobody: 'Nobody found.',
    au_t_admin: 'admin', au_t_banned: 'banned', au_t_supporter: 'supporter', au_t_mailnews: 'e-mail + news', au_t_unconf: 'e-mail unconfirmed', au_done: 'Done.', au_saved: 'Saved.',
    au_subject: 'Subject', au_msgph: 'Message (plain text)', au_msg: 'Message', au_joined: 'Joined', au_role: 'Role', au_r_admin: 'Administrator', au_r_user: 'Standard user',
    au_status: 'Status', au_s_banned: 'Banned', au_s_timed: 'Timed out until {d}', au_s_active: 'Active', au_confirmed: 'confirmed', au_notconf: 'not confirmed', au_wantsnews: ', wants news', au_none: 'none',
    au_activity: 'Activity', au_counts: '{a} chat messages · {b} classes · {c} notes', au_f_read: 'Can read books', au_f_upload: 'Can upload books', au_f_cv: 'Can see the résumé', au_f_mail: 'Can use the e-mail box', au_f_ads: 'Never sees ads',
    au_badge_off: 'Remove supporter badge', au_badge_on: 'Give supporter badge', au_timeout: 'Time out 1 hour', au_timeout_done: 'Timed out for 1 hour.', au_ban: 'Ban', au_ban_confirm: 'Ban {u}?', au_banned_done: 'Banned.',
    au_lift: 'Lift ban / timeout', au_lifted: 'Lifted.', au_sendmail: 'Send an e-mail', au_send: 'SEND', au_send_confirm: 'Send this message to {u}?',
    au_f_off: 'Saved in the queue: sending is OFF (MAIL_DRIVER).', au_f_sent: 'Sent.', au_f_queued: 'Queued.', au_unconf_note: 'The address is not confirmed yet: nothing can be sent to it.',
    au_noaddr: 'This person has not given an e-mail address.', au_hist: 'Latest e-mails to this person'
});
VBI18N.add('it', {
    wrong: 'Qualcosa è andato storto.',
    mb_sending: 'Invio: {d}', mb_off: 'Invio: SPENTO (MAIL_DRIVER è vuoto)', mb_counts: ' · oggi {a}/{b} · in attesa {c} · falliti {d}', mb_news: ' · possono ricevere novità: {a} (sostenitori {b})',
    mb_nothing: 'Qui non c\'è niente.', mb_nosubject: '(senza oggetto)', mb_people: '{n} persone', mb_readonly: 'Questo messaggio è stato inviato: non si può modificare.', mb_saved: 'Bozza salvata.',
    mb_test: 'Prova in coda ({n}). Premi INVIA ORA se nessun lavoro è attivo.', mb_confirm: 'Inviare questo messaggio a {n} persone? Non si può annullare.', mb_queued: 'In coda per {n} persone.',
    mb_del: 'Eliminare questa bozza?', mb_off2: 'L\'invio è SPENTO: imposta MAIL_DRIVER in .env.', mb_sent: 'Inviati {a}, in attesa {b}.',
    au_people: 'Persone', au_new7: 'Nuovi (7 giorni)', au_admins: 'Amministratori', au_banned: 'Bannati', au_withmail: 'Con e-mail', au_news: 'Vogliono le novità', au_nobody: 'Nessuno trovato.',
    au_t_admin: 'admin', au_t_banned: 'bannato', au_t_supporter: 'sostenitore', au_t_mailnews: 'e-mail + novità', au_t_unconf: 'e-mail non confermata', au_done: 'Fatto.', au_saved: 'Salvato.',
    au_subject: 'Oggetto', au_msgph: 'Messaggio (solo testo)', au_msg: 'Messaggio', au_joined: 'Iscritto il', au_role: 'Ruolo', au_r_admin: 'Amministratore', au_r_user: 'Utente normale',
    au_status: 'Stato', au_s_banned: 'Bannato', au_s_timed: 'Sospeso fino a {d}', au_s_active: 'Attivo', au_confirmed: 'confermato', au_notconf: 'non confermato', au_wantsnews: ', vuole le novità', au_none: 'nessuna',
    au_activity: 'Attività', au_counts: '{a} messaggi in chat · {b} classi · {c} appunti', au_f_read: 'Può leggere i libri', au_f_upload: 'Può caricare i libri', au_f_cv: 'Può vedere il curriculum', au_f_mail: 'Può usare la posta', au_f_ads: 'Non vede mai la pubblicità',
    au_badge_off: 'Togli il distintivo di sostenitore', au_badge_on: 'Dai il distintivo di sostenitore', au_timeout: 'Sospendi per 1 ora', au_timeout_done: 'Sospeso per 1 ora.', au_ban: 'Banna', au_ban_confirm: 'Bannare {u}?', au_banned_done: 'Bannato.',
    au_lift: 'Togli ban / sospensione', au_lifted: 'Tolto.', au_sendmail: 'Invia un\'e-mail', au_send: 'INVIA', au_send_confirm: 'Inviare questo messaggio a {u}?',
    au_f_off: 'Salvato in coda: l\'invio è SPENTO (MAIL_DRIVER).', au_f_sent: 'Inviato.', au_f_queued: 'In coda.', au_unconf_note: 'L\'indirizzo non è ancora confermato: non si può inviare nulla.',
    au_noaddr: 'Questa persona non ha indicato un indirizzo e-mail.', au_hist: 'Ultime e-mail a questa persona'
});
