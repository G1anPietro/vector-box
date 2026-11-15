<?php
// public/api/appunti_demo.php — the example class ("5ª A Informatica · Istituto di esempio").
// A class with invented timetable, topics, notes, study documents, tests, homework, announcements and scores, so that
// a new visitor can see what the notes pages do. Everybody can look at it (read-only: see classCanView); nobody can change it.
// bin/appunti-demo.php and the worker (bin/appunti-ai.php) call demoEnsure(): it writes the class once and refreshes the
// dates every day, so the "coming tests" are always in the future. Nothing here talks to the AI: the documents are written by hand.
require_once __DIR__ . '/appunti_lib.php';
require_once __DIR__ . '/classifica_lib.php';

const DEMO_CLASS_NAME = '5ª A Informatica';
const DEMO_SCHOOL = 'Istituto di esempio (dati finti)';
/** The made-up classmates: accounts nobody can log in to (the password hash "!" never matches). */
const DEMO_USERS = ['demo_giulia' => 'Giulia R.', 'demo_marco' => 'Marco B.', 'demo_sara' => 'Sara L.', 'demo_luca' => 'Luca F.', 'demo_elena' => 'Elena M.'];

function demoTimetable(): array {
    $days = [
        1 => ['Italiano', 'Italiano', 'Storia', 'Inglese', 'Matematica', 'Matematica'],
        2 => ['Informatica', 'Informatica', 'Sistemi e Reti', 'Sistemi e Reti', 'Matematica', 'Scienze motorie'],
        3 => ['Inglese', 'TPSIT', 'TPSIT', 'Italiano', 'Storia', 'Informatica'],
        4 => ['Sistemi e Reti', 'Sistemi e Reti', 'Informatica', 'Informatica', 'Inglese', 'Matematica'],
        5 => ['Italiano', 'Matematica', 'TPSIT', 'TPSIT', 'Scienze motorie', 'Storia'],
    ];
    $slots = [];
    foreach ($days as $d => $list) {
        foreach ($list as $i => $subject) {
            $slot = ['day' => $d, 'period' => $i + 1, 'subject' => $subject];
            if (in_array($subject, ['Informatica', 'Sistemi e Reti', 'TPSIT'], true)) { $slot['label'] = 'Lab'; $slot['room'] = 'Lab 2'; }
            if ($subject === 'Scienze motorie') $slot['room'] = 'Palestra';
            $slots[] = $slot;
        }
    }
    $bells = [['08:00', '09:00'], ['09:00', '10:00'], ['10:00', '11:00'], ['11:10', '12:10'], ['12:10', '13:10'], ['13:10', '14:10']];
    return [array_map(fn($b) => ['start' => $b[0], 'end' => $b[1]], $bells), $slots];
}

/** The invented material: topics, notes, documents. Dates are offsets from today, resolved by demoEnsure(). */
function demoContent(): array {
    $quizSql = ['questions' => [
        ['topic' => 'Modello relazionale', 'question' => 'Che cosa identifica in modo univoco una riga di una tabella?', 'options' => ['La chiave esterna', 'La chiave primaria', 'Il nome della tabella', 'L\'indice di colonna'], 'answer' => 1, 'explanation' => 'La chiave primaria è un attributo (o un insieme) che non si ripete e non può essere NULL.', 'prof' => true],
        ['topic' => 'Modello relazionale', 'question' => 'A che cosa serve una chiave esterna?', 'options' => ['A ordinare i risultati', 'A collegare una tabella a un\'altra', 'A cifrare i dati', 'A eliminare i duplicati'], 'answer' => 1, 'explanation' => 'Una chiave esterna fa riferimento alla chiave primaria di un\'altra tabella e garantisce l\'integrità referenziale.'],
        ['topic' => 'SELECT', 'question' => 'Quale clausola filtra le righe PRIMA del raggruppamento?', 'options' => ['HAVING', 'ORDER BY', 'WHERE', 'LIMIT'], 'answer' => 2, 'explanation' => 'WHERE agisce sulle singole righe; HAVING agisce sui gruppi già formati da GROUP BY.', 'prof' => true],
        ['topic' => 'SELECT', 'question' => 'Che cosa restituisce SELECT COUNT(*) FROM studenti?', 'options' => ['Il nome del primo studente', 'Il numero di righe della tabella', 'La somma delle età', 'Una tabella vuota'], 'answer' => 1, 'explanation' => 'COUNT(*) conta tutte le righe, anche quelle con valori NULL.'],
        ['topic' => 'JOIN', 'question' => 'Quale JOIN restituisce solo le righe con corrispondenza in entrambe le tabelle?', 'options' => ['LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN'], 'answer' => 2, 'explanation' => 'INNER JOIN tiene solo le coppie di righe che soddisfano la condizione ON.', 'prof' => true],
        ['topic' => 'JOIN', 'question' => 'Con un LEFT JOIN, che cosa succede alle righe della tabella di sinistra senza corrispondenza?', 'options' => ['Vengono scartate', 'Restano, con NULL nelle colonne dell\'altra tabella', 'Generano un errore', 'Vengono duplicate'], 'answer' => 1, 'explanation' => 'Il LEFT JOIN conserva sempre tutte le righe di sinistra.'],
        ['topic' => 'GROUP BY', 'question' => 'Quale query dà il numero di studenti per classe?', 'options' => ['SELECT classe, COUNT(*) FROM studenti GROUP BY classe', 'SELECT COUNT(*) FROM studenti WHERE classe', 'SELECT classe FROM studenti ORDER BY COUNT(*)', 'SELECT * FROM studenti GROUP classe'], 'answer' => 0, 'explanation' => 'GROUP BY raggruppa le righe per classe e COUNT(*) le conta in ogni gruppo.'],
        ['topic' => 'Normalizzazione', 'question' => 'Una tabella è in prima forma normale (1FN) quando…', 'options' => ['non ha chiavi', 'ogni attributo contiene un solo valore atomico', 'non ha chiavi esterne', 'ha una sola colonna'], 'answer' => 1, 'explanation' => 'La 1FN richiede valori atomici: niente liste dentro una cella.'],
    ]];
    $quizStoria = ['questions' => [
        ['topic' => 'Cause', 'question' => 'Quale episodio fece scoppiare la Prima guerra mondiale?', 'options' => ['L\'invasione del Belgio', 'L\'attentato di Sarajevo del 1914', 'Il naufragio del Lusitania', 'La rivoluzione russa'], 'answer' => 1, 'explanation' => 'L\'assassinio dell\'arciduca Francesco Ferdinando a Sarajevo (28 giugno 1914) innescò il sistema di alleanze.', 'prof' => true],
        ['topic' => 'Alleanze', 'question' => 'Quali Paesi formavano la Triplice Intesa?', 'options' => ['Germania, Austria, Italia', 'Francia, Gran Bretagna, Russia', 'Francia, Germania, Russia', 'Gran Bretagna, Italia, Austria'], 'answer' => 1, 'explanation' => 'Francia, Gran Bretagna e Russia contro gli Imperi centrali.'],
        ['topic' => 'Italia', 'question' => 'Quando entrò in guerra l\'Italia?', 'options' => ['Agosto 1914', 'Maggio 1915', 'Aprile 1917', 'Novembre 1918'], 'answer' => 1, 'explanation' => 'Con il Patto di Londra l\'Italia si schierò con l\'Intesa nel maggio 1915.', 'prof' => true],
        ['topic' => 'Guerra di trincea', 'question' => 'Che cosa caratterizzò la guerra sul fronte occidentale?', 'options' => ['Rapidi movimenti di cavalleria', 'La guerra di posizione nelle trincee', 'Battaglie solo navali', 'L\'assenza di armi automatiche'], 'answer' => 1, 'explanation' => 'Mitragliatrici e filo spinato resero impossibili le offensive rapide: si combatté per anni nelle trincee.'],
        ['topic' => 'Conclusione', 'question' => 'Quale trattato impose dure condizioni alla Germania nel 1919?', 'options' => ['Trattato di Versailles', 'Trattato di Londra', 'Pace di Westfalia', 'Trattato di Brest-Litovsk'], 'answer' => 0, 'explanation' => 'Versailles: perdite territoriali, riduzione dell\'esercito e riparazioni di guerra.'],
    ]];
    $schemaSql = ['title' => 'Database relazionali e SQL', 'children' => [
        ['label' => 'Modello relazionale', 'children' => [
            ['label' => 'Tabella (relazione)', 'note' => 'righe = tuple, colonne = attributi'],
            ['label' => 'Chiave primaria', 'note' => 'univoca, mai NULL'],
            ['label' => 'Chiave esterna', 'note' => 'collega due tabelle'],
        ]],
        ['label' => 'Interrogare con SELECT', 'children' => [
            ['label' => 'SELECT … FROM', 'children' => [['label' => 'colonne e alias']]],
            ['label' => 'WHERE', 'note' => 'filtra le righe'],
            ['label' => 'ORDER BY / LIMIT'],
        ]],
        ['label' => 'JOIN', 'children' => [
            ['label' => 'INNER JOIN', 'note' => 'solo corrispondenze'],
            ['label' => 'LEFT JOIN', 'note' => 'tutte le righe di sinistra'],
            ['label' => 'ON e alias di tabella'],
        ]],
        ['label' => 'Aggregazioni', 'children' => [
            ['label' => 'COUNT, SUM, AVG, MIN, MAX'],
            ['label' => 'GROUP BY'],
            ['label' => 'HAVING', 'note' => 'filtra i gruppi'],
        ]],
        ['label' => 'Normalizzazione', 'children' => [
            ['label' => '1FN: valori atomici'],
            ['label' => '2FN: niente dipendenze parziali'],
            ['label' => '3FN: niente dipendenze transitive'],
        ]],
    ]];
    $schemaOsi = ['title' => 'Modello ISO/OSI', 'children' => [
        ['label' => 'Livelli alti', 'children' => [['label' => '7 Applicazione', 'note' => 'HTTP, SMTP, DNS'], ['label' => '6 Presentazione', 'note' => 'codifica, cifratura'], ['label' => '5 Sessione']]],
        ['label' => 'Trasporto', 'children' => [['label' => '4 Trasporto', 'note' => 'TCP affidabile, UDP veloce']]],
        ['label' => 'Livelli bassi', 'children' => [['label' => '3 Rete', 'note' => 'indirizzi IP, routing'], ['label' => '2 Collegamento', 'note' => 'MAC, switch'], ['label' => '1 Fisico', 'note' => 'cavi, segnali']]],
        ['label' => 'TCP/IP', 'children' => [['label' => 'Applicazione (7-5)'], ['label' => 'Trasporto'], ['label' => 'Internet'], ['label' => 'Accesso alla rete (2-1)']]],
    ]];
    $domandeSql = ['domande' => [
        ['domanda' => 'Che differenza c\'è tra WHERE e HAVING?', 'risposta' => 'WHERE filtra le **righe** prima del raggruppamento; HAVING filtra i **gruppi** dopo GROUP BY e può usare le funzioni di aggregazione.', 'origine' => 'prof', 'fonte' => '[4]'],
        ['domanda' => 'Quando si usa un LEFT JOIN al posto di un INNER JOIN?', 'risposta' => 'Quando si vogliono anche le righe della tabella di sinistra senza corrispondenza (es. clienti senza ordini): le colonne dell\'altra tabella saranno NULL.', 'origine' => 'prof', 'fonte' => '[3]'],
        ['domanda' => 'Perché una chiave primaria non può essere NULL?', 'risposta' => 'Perché deve identificare ogni riga in modo univoco: un valore NULL (sconosciuto) non identifica nulla.', 'origine' => 'ai', 'fonte' => '[1]'],
        ['domanda' => 'Che cos\'è l\'integrità referenziale?', 'risposta' => 'La garanzia che ogni valore di una chiave esterna esista davvero come chiave primaria nella tabella collegata.', 'origine' => 'ai', 'fonte' => '[1]'],
    ]];
    $domandeOsi = ['domande' => [
        ['domanda' => 'Qual è la differenza tra TCP e UDP?', 'risposta' => 'TCP è orientato alla connessione e affidabile (conferme, ritrasmissioni, ordine); UDP non garantisce nulla ma è più veloce: adatto a streaming e giochi.', 'origine' => 'prof', 'fonte' => '[2]'],
        ['domanda' => 'A quale livello lavora uno switch?', 'risposta' => 'Al livello 2 (collegamento dati), usando gli indirizzi MAC.', 'origine' => 'ai', 'fonte' => '[1]'],
    ]];

    return [
        'topics' => [
            'Informatica' => [['Database relazionali e SQL', -22, null]],
            'Sistemi e Reti' => [['Modello ISO/OSI e TCP/IP', -20, null]],
            'Storia' => [['La Prima guerra mondiale', -24, null]],
            'Italiano' => [['Luigi Pirandello', -21, null]],
            'Inglese' => [['Present perfect', -15, null]],
            'Matematica' => [['Gli integrali', -23, null]],
            'TPSIT' => [['Servizi web e HTTP', -14, null]],
        ],
        // subject => list of [kind, author (index in DEMO_USERS), title, body, which lesson of the subject (0 = oldest shown)]
        'items' => [
            'Informatica' => [
                ['appunti', 0, 'Il modello relazionale', "Una base di dati relazionale è fatta di TABELLE (relazioni). Ogni riga è una TUPLA, ogni colonna un ATTRIBUTO.\nChiave primaria: identifica in modo univoco ogni riga, non può essere NULL né ripetersi.\nChiave esterna: un attributo che richiama la chiave primaria di un'altra tabella (es. id_classe in studenti → classi). Garantisce l'integrità referenziale.\nEsempio: studenti(id, nome, cognome, id_classe), classi(id, anno, sezione)."],
                ['slide', 1, 'Slide del prof: SELECT e WHERE', "SELECT colonne FROM tabella WHERE condizione ORDER BY colonna LIMIT n;\nOperatori: =, <>, <, >, BETWEEN, IN, LIKE ('A%'), IS NULL.\nAlias: SELECT nome AS studente FROM studenti s;"],
                ['appunti', 2, 'JOIN tra tabelle', "INNER JOIN: restituisce solo le righe che hanno corrispondenza in entrambe le tabelle.\nSELECT s.nome, c.sezione FROM studenti s INNER JOIN classi c ON s.id_classe = c.id;\nLEFT JOIN: tiene TUTTE le righe di sinistra; dove manca la corrispondenza mette NULL.\nAttenzione a scrivere sempre la condizione ON: senza, si ottiene il prodotto cartesiano."],
                ['domande', 3, 'Domande fatte dal prof', "- Differenza tra WHERE e HAVING?\n- Quando serve un LEFT JOIN?\n- Come si conta il numero di studenti per classe?"],
                ['appunti', 4, 'GROUP BY e funzioni di aggregazione', "COUNT, SUM, AVG, MIN, MAX lavorano su più righe e restituiscono un solo valore.\nSELECT id_classe, COUNT(*) FROM studenti GROUP BY id_classe HAVING COUNT(*) > 20;\nOgni colonna del SELECT che non è aggregata deve comparire nel GROUP BY."],
            ],
            'Sistemi e Reti' => [
                ['appunti', 1, 'ISO/OSI: i sette livelli', "Dall'alto: Applicazione, Presentazione, Sessione, Trasporto, Rete, Collegamento dati, Fisico.\nOgni livello offre servizi a quello sopra e usa quello sotto (incapsulamento: ogni livello aggiunge la sua intestazione).\nTrucco per ricordarli: 'All People Seem To Need Data Processing'."],
                ['slide', 0, 'Slide: TCP e UDP', "TCP: connessione (three-way handshake SYN, SYN-ACK, ACK), conferme, ritrasmissioni, controllo di flusso.\nUDP: nessuna connessione, nessuna garanzia, intestazione leggera. Usato da DNS, streaming, giochi."],
            ],
            'Storia' => [
                ['appunti', 2, 'Le cause della Grande Guerra', "Cause profonde: rivalità imperialiste, nazionalismi, corsa agli armamenti, sistema di alleanze (Triplice Alleanza e Triplice Intesa).\nCausa immediata: attentato di Sarajevo, 28 giugno 1914. L'Austria dichiara guerra alla Serbia, le alleanze fanno il resto."],
                ['libro', 3, 'Libro: capitolo 14 (sintesi)', "Il fronte occidentale si blocca nel 1914: guerra di trincea, mitragliatrici, gas. L'Italia entra in guerra il 24 maggio 1915 con l'Intesa (Patto di Londra)."],
                ['appunti', 0, 'La svolta del 1917', "1917: la Russia esce dalla guerra dopo la rivoluzione; gli Stati Uniti entrano a fianco dell'Intesa. Caporetto (ottobre): grave sconfitta italiana. 1918: armistizio; 1919: Trattato di Versailles."],
            ],
            'Italiano' => [
                ['appunti', 4, 'Pirandello: la poetica dell\'umorismo', "Umorismo = 'sentimento del contrario': dietro il riso c'è la riflessione che coglie la contraddizione.\nL'esempio della vecchia signora truccata: prima si ride (avvertimento del contrario), poi si prova pena (sentimento del contrario).\nTemi: la maschera, la crisi dell'identità, la forma che imprigiona la vita."],
                ['libro', 1, 'Il fu Mattia Pascal (trama)', "Mattia Pascal, creduto morto, assume l'identità di Adriano Meis ma scopre che senza documenti non può vivere. Torna a casa: 'il fu Mattia Pascal'."],
            ],
            'Matematica' => [
                ['appunti', 3, 'Integrali indefiniti', "L'integrale indefinito di f(x) è l'insieme di tutte le primitive: ∫f(x)dx = F(x) + c.\n∫x^n dx = x^(n+1)/(n+1) + c (n ≠ −1); ∫1/x dx = ln|x| + c; ∫e^x dx = e^x + c."],
                ['prova', 2, 'Esercizi di preparazione', "Calcola: ∫(3x² − 2x + 1)dx; ∫(1/x + e^x)dx; ∫cos(x)dx."],
            ],
            'Inglese' => [
                ['appunti', 1, 'Present perfect', "Form: have/has + past participle. Uses: experience (I have visited London), recent actions with a result now, unfinished time (this week). Signal words: ever, never, already, yet, just, since, for."],
            ],
            'TPSIT' => [
                ['appunti', 0, 'HTTP: richieste e risposte', "Metodi: GET (leggere), POST (inviare), PUT/PATCH (modificare), DELETE.\nCodici di stato: 200 OK, 301 redirect, 404 non trovato, 500 errore del server.\nUn'API REST espone risorse con URL e usa i metodi HTTP."],
            ],
        ],
        // lesson documents (Markdown), made from the notes above: subject => [lesson index => [title, markdown]]
        'lesson_docs' => [
            'Informatica' => [
                2 => ["# JOIN tra tabelle\n\nUn **JOIN** combina le righe di due tabelle in base a una condizione, di solito l'uguaglianza tra chiave esterna e chiave primaria.\n\n## INNER JOIN\nRestituisce solo le righe con corrispondenza in entrambe le tabelle.\n\n```sql\nSELECT s.nome, c.sezione\nFROM studenti s\nINNER JOIN classi c ON s.id_classe = c.id;\n```\n\n## LEFT JOIN\nTiene **tutte** le righe della tabella di sinistra; dove manca la corrispondenza le colonne dell'altra tabella valgono `NULL`. Utile per trovare, ad esempio, le classi senza studenti.\n\n## Da ricordare\n- Scrivi sempre la condizione `ON`: senza si ottiene il prodotto cartesiano.\n- Usa gli alias (`s`, `c`) per non ripetere il nome della tabella.\n- *Il prof ha chiesto:* quando serve un LEFT JOIN? [3]", $domandeSql, $schemaSql],
                4 => ["# GROUP BY e aggregazioni\n\nLe funzioni di aggregazione (**COUNT, SUM, AVG, MIN, MAX**) lavorano su più righe e restituiscono un solo valore.\n\n```sql\nSELECT id_classe, COUNT(*) AS studenti\nFROM studenti\nGROUP BY id_classe\nHAVING COUNT(*) > 20;\n```\n\n- **GROUP BY** forma i gruppi.\n- **WHERE** filtra le righe *prima* dei gruppi; **HAVING** filtra i gruppi *dopo*.\n- Ogni colonna del `SELECT` che non è aggregata deve comparire nel `GROUP BY`. [5]", null, null],
            ],
            'Sistemi e Reti' => [
                0 => ["# Il modello ISO/OSI\n\nSette livelli, dal più vicino all'utente al più vicino al cavo: **Applicazione, Presentazione, Sessione, Trasporto, Rete, Collegamento dati, Fisico**.\n\nOgni livello offre servizi a quello superiore e usa quello inferiore: scendendo, ogni livello aggiunge la propria intestazione (*incapsulamento*).\n\n| Livello | Esempi |\n|---|---|\n| 7 Applicazione | HTTP, SMTP, DNS |\n| 4 Trasporto | TCP, UDP |\n| 3 Rete | IP, router |\n| 2 Collegamento | MAC, switch |\n| 1 Fisico | cavi, segnali |\n\n**TCP** è affidabile (handshake a tre vie, conferme); **UDP** è veloce ma senza garanzie. [1] [2]", $domandeOsi, $schemaOsi],
            ],
            'Storia' => [
                0 => ["# Le cause della Prima guerra mondiale\n\n**Cause profonde**\n- rivalità imperialiste e commerciali tra le potenze europee;\n- nazionalismi (soprattutto nei Balcani);\n- corsa agli armamenti;\n- due blocchi di alleanze: Triplice Alleanza (Germania, Austria-Ungheria, Italia) e Triplice Intesa (Francia, Gran Bretagna, Russia).\n\n**Causa immediata**: l'attentato di Sarajevo (28 giugno 1914) contro l'arciduca Francesco Ferdinando. L'Austria attacca la Serbia e il sistema delle alleanze trascina in guerra l'intera Europa. [1]", null, null],
            ],
            'Italiano' => [
                0 => ["# Pirandello e l'umorismo\n\nPer Pirandello l'**umorismo** nasce dal *sentimento del contrario*: davanti a una vecchia signora truccata in modo eccessivo prima si ride (**avvertimento del contrario**), poi la riflessione fa capire la sua sofferenza e il riso diventa pena (**sentimento del contrario**).\n\nTemi ricorrenti: la **maschera**, la crisi dell'identità, il conflitto tra *forma* e *vita*. Nel romanzo *Il fu Mattia Pascal* il protagonista cambia identità ma scopre di non poter vivere senza una forma sociale. [1] [2]", null, null],
            ],
        ],
        'event_docs' => [
            'Informatica' => [
                'completo' => "# Verifica di Informatica — dispensa completa\n\n## 1. Il modello relazionale\nUna base di dati relazionale è un insieme di **tabelle**. Ogni riga è una *tupla*, ogni colonna un *attributo*.\n- **Chiave primaria**: identifica la riga; univoca, mai `NULL`.\n- **Chiave esterna**: richiama la chiave primaria di un'altra tabella e garantisce l'**integrità referenziale**.\n\n## 2. SELECT\n`SELECT colonne FROM tabella WHERE condizione ORDER BY colonna LIMIT n;`\nOperatori: `=`, `<>`, `BETWEEN`, `IN`, `LIKE`, `IS NULL`.\n\n## 3. JOIN\n- **INNER JOIN**: solo le corrispondenze.\n- **LEFT JOIN**: tutte le righe di sinistra, `NULL` dove manca l'altra.\n- Scrivere sempre `ON`, altrimenti prodotto cartesiano.\n\n## 4. Aggregazioni\n`COUNT, SUM, AVG, MIN, MAX` + `GROUP BY` (forma i gruppi) + `HAVING` (filtra i gruppi). `WHERE` filtra le righe prima.\n\n## 5. Normalizzazione\n- **1FN**: valori atomici.\n- **2FN**: nessuna dipendenza parziale dalla chiave.\n- **3FN**: nessuna dipendenza transitiva.\n\n## Domande fatte dal prof\n- Differenza tra WHERE e HAVING? → vedi punto 4.\n- Quando serve un LEFT JOIN? → vedi punto 3.",
                'riassunto' => "# Riassunto — Database e SQL\n\n- Un **database relazionale** = tabelle collegate da **chiavi** (primaria: univoca; esterna: collega).\n- **SELECT … FROM … WHERE … ORDER BY** per interrogare.\n- **INNER JOIN** = solo corrispondenze; **LEFT JOIN** = tutte le righe di sinistra.\n- **GROUP BY** + funzioni (COUNT, SUM, AVG…) per i totali; **HAVING** filtra i gruppi, **WHERE** le righe.\n- **Normalizzare** (1FN, 2FN, 3FN) evita ripetizioni e anomalie.",
                'scheda' => "# Scheda lampo — SQL\n\n- PK = univoca, mai NULL\n- FK = punta alla PK di un'altra tabella\n- WHERE → righe; HAVING → gruppi\n- INNER JOIN = incrocio; LEFT JOIN = tutto a sinistra\n- Tutte le colonne non aggregate vanno nel GROUP BY\n- 1FN atomici · 2FN no dip. parziali · 3FN no dip. transitive",
                'preparazione' => "# Come prepararti alla verifica di SQL\n\n**Cosa studiare (in ordine)**\n1. Chiavi e modello relazionale (1 sera).\n2. SELECT, WHERE, ORDER BY: scrivi 5 query a mano.\n3. JOIN: disegna due tabelle e prevedi il risultato prima di eseguirlo.\n4. GROUP BY e HAVING: la differenza con WHERE è una domanda tipica del prof.\n\n**Errori comuni**\n- dimenticare `ON` nel JOIN;\n- mettere nel SELECT colonne non aggregate e non nel GROUP BY;\n- usare `= NULL` invece di `IS NULL`.\n\n**Prima della verifica**: rifai il quiz e la scheda lampo.",
            ],
            'Storia' => [
                'riassunto' => "# Riassunto — La Prima guerra mondiale\n\n- **Cause**: imperialismi, nazionalismi, armamenti, alleanze. **Scintilla**: Sarajevo, 28 giugno 1914.\n- **Blocchi**: Intesa (Francia, GB, Russia) contro Imperi centrali (Germania, Austria-Ungheria).\n- **Guerra di trincea** sul fronte occidentale.\n- **Italia**: neutrale, poi in guerra il 24 maggio 1915 (Patto di Londra); Caporetto 1917; vittoria a Vittorio Veneto 1918.\n- **1917**: la Russia esce, entrano gli USA. **1919**: Trattato di Versailles.",
                'scheda' => "# Scheda lampo — Prima guerra mondiale\n\n- 28/6/1914 Sarajevo\n- 24/5/1915 Italia in guerra\n- 1917 Russia fuori, USA dentro, Caporetto\n- 11/11/1918 armistizio\n- 1919 Versailles",
            ],
        ],
        'event_quiz' => ['Informatica' => $quizSql, 'Storia' => $quizStoria],
        'event_schema' => ['Informatica' => $schemaSql],
    ];
}

/** Writes the example class when missing, and rewrites its dates once a day. Returns true when it wrote something. */
function demoEnsure(PDO $db, bool $force = false): bool {
    $class = $db->query('SELECT * FROM school_classes WHERE is_demo = 1 LIMIT 1')->fetch();
    $today = $class ? classToday($class) : (new DateTimeImmutable('now', new DateTimeZone('Europe/Rome')))->format('Y-m-d');
    if ($class && !$force && appSetting($db, 'demo_seed_day', '') === $today) return false;

    $now = time();
    $db->exec('BEGIN IMMEDIATE');
    try {
        // the fake classmates
        $ids = [];
        $ins = $db->prepare("INSERT OR IGNORE INTO accounts (username, password_hash, theme, is_admin) VALUES (:u, '!', 'monochrome', 0)");
        $get = $db->prepare('SELECT id FROM accounts WHERE username = :u');
        foreach (array_keys(DEMO_USERS) as $u) { $ins->execute([':u' => $u]); $get->execute([':u' => $u]); $ids[] = (int)$get->fetchColumn(); }

        if (!$class) {
            $db->prepare("INSERT INTO school_classes (name, school, status, manager_id, invite_code, request_note, timezone, created_at, decided_at, is_demo)
                          VALUES (:n, :s, 'active', :m, NULL, 'Classe di esempio', 'Europe/Rome', :t, :t, 1)")
               ->execute([':n' => DEMO_CLASS_NAME, ':s' => DEMO_SCHOOL, ':m' => $ids[0], ':t' => $now]);
            $class = $db->query('SELECT * FROM school_classes WHERE is_demo = 1 LIMIT 1')->fetch();
        }
        $cid = (int)$class['id'];
        $today = classToday($class);
        foreach (['class_members', 'class_subjects', 'class_timetables', 'class_items', 'class_item_files', 'class_events', 'class_docs', 'class_bell_sent', 'review_cards',
                  'class_roles', 'class_topics', 'class_homework', 'class_days_off', 'class_turns', 'class_board', 'quiz_answers', 'score_events', 'class_log'] as $table) {
            $db->prepare("DELETE FROM $table WHERE class_id = :c")->execute([':c' => $cid]);
        }
        $db->prepare('UPDATE school_classes SET manager_id = :m, name = :n, school = :s, status = \'active\', invite_code = NULL, settings = \'{}\' WHERE id = :c')
           ->execute([':m' => $ids[0], ':n' => DEMO_CLASS_NAME, ':s' => DEMO_SCHOOL, ':c' => $cid]);
        $db->prepare("DELETE FROM notifications WHERE user_id IN (" . implode(',', $ids) . ')')->execute();

        $day = fn(int $off) => (new DateTimeImmutable($today))->modify(($off >= 0 ? '+' : '') . $off . ' days')->format('Y-m-d');
        $content = demoContent();

        // members (the first one is the representative) and a role
        $role = $db->prepare('INSERT INTO class_roles (class_id, name, color, perms, created_at) VALUES (:c, :n, :col, :p, :t)');
        $role->execute([':c' => $cid, ':n' => 'Segretario', ':col' => '#5b8def', ':p' => json_encode(['material', 'calendar', 'homework', 'board']), ':t' => $now]);
        $roleId = (int)$db->lastInsertId();
        $mem = $db->prepare('INSERT INTO class_members (class_id, user_id, joined_at, display_name, role_id) VALUES (:c, :u, :t, :d, :r)');
        $names = array_values(DEMO_USERS);
        foreach ($ids as $i => $uid) $mem->execute([':c' => $cid, ':u' => $uid, ':t' => $now - 86400 * 40, ':d' => $names[$i], ':r' => $i === 1 ? $roleId : null]);

        // timetable
        [$bells, $slots] = demoTimetable();
        $periods = classParsePeriods($bells);
        $parsed = classParseSlots($slots, $periods);
        if (is_string($periods) || is_string($parsed)) throw new RuntimeException('demo timetable: ' . (is_string($periods) ? $periods : $parsed));
        $subj = classEnsureSubjects($db, $cid, array_column($parsed, 'subject'));
        $stored = array_map(fn($s) => ['day' => $s['day'], 'period' => $s['period'], 'subject_id' => $subj[$s['subject']], 'label' => $s['label'], 'room' => $s['room']], $parsed);
        $db->prepare('UPDATE school_classes SET periods = :p WHERE id = :id')->execute([':p' => json_encode($periods), ':id' => $cid]);
        $db->prepare('INSERT INTO class_timetables (class_id, valid_from, slots, created_at) VALUES (:c, :f, :s, :t)')
           ->execute([':c' => $cid, ':f' => $day(-120), ':s' => json_encode($stored), ':t' => $now]);

        // the days each subject has a lesson, in the last 4 weeks (oldest first)
        $lessonDays = [];
        for ($off = -28; $off <= -1; $off++) {
            $date = $day($off);
            $dow = (int)(new DateTimeImmutable($date))->format('N');
            foreach ($parsed as $s) if ($s['day'] === $dow) $lessonDays[$s['subject']][$date] = true;
        }
        $lessonDays = array_map(fn($d) => array_keys($d), $lessonDays);

        // topics
        $topicId = [];
        $tIns = $db->prepare("INSERT INTO class_topics (class_id, subject_id, name, start_date, end_date, status, author_id, created_at, updated_at) VALUES (:c, :s, :n, :f, :e, 'ok', :a, :t, :t)");
        foreach ($content['topics'] as $subject => $list) {
            foreach ($list as [$name, $startOff, $endOff]) {
                $tIns->execute([':c' => $cid, ':s' => $subj[$subject], ':n' => $name, ':f' => $day($startOff), ':e' => $endOff === null ? null : $day($endOff), ':a' => $ids[0], ':t' => $now]);
                $topicId[$subject] = (int)$db->lastInsertId();
            }
        }

        // notes: spread over the latest lesson days of each subject
        $itemIns = $db->prepare("INSERT INTO class_items (class_id, subject_id, kind, lesson_date, period, title, body, author_id, source, created_at, updated_at, topic_id, topic_manual, ai_state)
                                 VALUES (:c, :s, :k, :d, NULL, :ti, :b, :a, 'site', :t, :t, :top, 1, 'done')");
        $lessonDateOf = [];       // subject => [item number => date]
        foreach ($content['items'] as $subject => $items) {
            $days = $lessonDays[$subject] ?? [];
            $take = array_slice($days, -count($items));
            foreach ($items as $n => [$kind, $author, $title, $body]) {
                $date = $take[$n] ?? end($days);
                $lessonDateOf[$subject][$n] = $date;
                $itemIns->execute([':c' => $cid, ':s' => $subj[$subject], ':k' => $kind, ':d' => $date, ':ti' => $title, ':b' => $body, ':a' => $ids[$author],
                                   ':t' => (new DateTimeImmutable($date . ' 17:00'))->getTimestamp(), ':top' => $topicId[$subject] ?? null]);
            }
        }

        // study documents of the lessons (what the AI writes from the notes)
        $docIns = $db->prepare("INSERT INTO class_docs (class_id, doc_key, subject_id, kind, lesson_date, event_id, title, content, sources, input_hash, model, status, created_at, updated_at, topic_id)
                                VALUES (:c, :k, :s, :kind, :d, :e, :ti, :co, '[]', 'demo', 'demo', 'ok', :t, :t, :top)");
        $addDoc = function (string $key, string $subject, string $kind, ?string $date, ?int $eventId, string $title, string $text) use ($docIns, $cid, $subj, $now, $topicId) {
            $docIns->execute([':c' => $cid, ':k' => $key, ':s' => $subj[$subject], ':kind' => $kind, ':d' => $date, ':e' => $eventId, ':ti' => $title, ':co' => $text, ':t' => $now, ':top' => $topicId[$subject] ?? null]);
        };
        foreach ($content['lesson_docs'] as $subject => $byLesson) {
            foreach ($byLesson as $n => [$md, $domande, $schema]) {
                $date = $lessonDateOf[$subject][$n] ?? null;
                if (!$date) continue;
                $fmt = (new DateTimeImmutable($date))->format('d/m/Y');
                $sid = $subj[$subject];
                $addDoc("lezione:$sid:$date", $subject, 'lezione', $date, null, "$subject — lezione del $fmt", $md);
                if ($domande) $addDoc("domande:$sid:$date", $subject, 'domande', $date, null, "$subject — domande del $fmt", json_encode($domande, JSON_UNESCAPED_UNICODE));
                if ($schema) $addDoc("schema:$sid:$date", $subject, 'schema', $date, null, "$subject — schema del $fmt", json_encode($schema, JSON_UNESCAPED_UNICODE));
            }
        }

        // the calendar: a test already done, and coming ones with their study documents
        $evIns = $db->prepare('INSERT INTO class_events (class_id, subject_id, kind, event_date, title, topics, author_id, created_at, updated_at) VALUES (:c, :s, :k, :d, :ti, :tp, :a, :t, :t)');
        $events = [
            ['Matematica', 'verifica', -3, 'Verifica sugli integrali', 'Integrali indefiniti, primitive, integrazione per scomposizione'],
            ['Informatica', 'verifica', 5, 'Verifica di SQL', 'Modello relazionale, SELECT, JOIN, GROUP BY, normalizzazione'],
            ['Storia', 'verifica', 9, 'Verifica: la Grande Guerra', 'Cause, alleanze, guerra di trincea, intervento italiano, Versailles'],
            ['Italiano', 'interrogazione', 12, 'Interrogazione su Pirandello', 'Umorismo, Il fu Mattia Pascal'],
            ['Inglese', 'verifica', 16, 'Test di grammatica', 'Present perfect, past simple'],
        ];
        $eventId = [];
        foreach ($events as [$subject, $kind, $off, $title, $topics]) {
            $evIns->execute([':c' => $cid, ':s' => $subj[$subject], ':k' => $kind, ':d' => $day($off), ':ti' => $title, ':tp' => $topics, ':a' => $ids[1], ':t' => $now]);
            $eventId[$subject] = (int)$db->lastInsertId();
        }
        $docTitles = ['completo' => 'Dispensa completa', 'riassunto' => 'Riassunto', 'scheda' => 'Scheda lampo', 'preparazione' => 'Come prepararsi', 'quiz' => 'Quiz', 'schema' => 'Schema'];
        foreach (['Informatica', 'Storia'] as $subject) {
            $eid = $eventId[$subject];
            $when = (new DateTimeImmutable($day($subject === 'Informatica' ? 5 : 9)))->format('d/m');
            foreach ($content['event_docs'][$subject] ?? [] as $kind => $text) $addDoc("evento:$eid:$kind", $subject, $kind, null, $eid, "$subject — {$docTitles[$kind]} (verifica del $when)", $text);
            if (isset($content['event_quiz'][$subject])) $addDoc("evento:$eid:quiz", $subject, 'quiz', null, $eid, "$subject — {$docTitles['quiz']} (verifica del $when)", json_encode($content['event_quiz'][$subject], JSON_UNESCAPED_UNICODE));
            if (isset($content['event_schema'][$subject])) $addDoc("evento:$eid:schema", $subject, 'schema', null, $eid, "$subject — {$docTitles['schema']} (verifica del $when)", json_encode($content['event_schema'][$subject], JSON_UNESCAPED_UNICODE));
        }

        // homework, a day without lessons, announcements
        $hw = $db->prepare('INSERT INTO class_homework (class_id, subject_id, due_date, body, author_id, created_at, updated_at) VALUES (:c, :s, :d, :b, :a, :t, :t)');
        foreach ([['Informatica', 2, 'Esercizi 12-15 di pag. 187 (JOIN tra tre tabelle)'], ['Storia', 3, 'Leggere il capitolo 14 e fare lo schema delle cause della guerra'], ['Inglese', 1, 'Workbook p. 63, esercizi 1-4 (present perfect)'], ['Matematica', 4, 'Esercizi sugli integrali, foglio 7']] as [$subject, $off, $body]) {
            $hw->execute([':c' => $cid, ':s' => $subj[$subject], ':d' => $day($off), ':b' => $body, ':a' => $ids[1], ':t' => $now]);
        }
        $db->prepare('INSERT INTO class_days_off (class_id, date_from, date_to, period, reason, author_id, created_at) VALUES (:c, :f, :f, NULL, :r, :a, :t)')
           ->execute([':c' => $cid, ':f' => $day(6), ':r' => 'Assemblea di istituto', ':a' => $ids[1], ':t' => $now]);
        $bb = $db->prepare("INSERT INTO class_board (class_id, kind, title, body, status, pinned, author_id, created_at) VALUES (:c, 'annuncio', :ti, :b, 'open', :p, :a, :t)");
        $bb->execute([':c' => $cid, ':ti' => 'Benvenuto nella classe di esempio', ':b' => "Questa classe è inventata: serve a far vedere cosa fanno gli Appunti. Puoi guardare l'orario, il calendario, il materiale, i documenti di studio, i quiz e la classifica, ma non modificare nulla.\nPer usarli con la tua classe, entra con il codice d'invito del rappresentante.", ':p' => 1, ':a' => $ids[0], ':t' => $now]);
        $bb->execute([':c' => $cid, ':ti' => 'Gita a Milano: autorizzazione', ':b' => 'Consegnare l\'autorizzazione firmata entro venerdì al rappresentante.', ':p' => 0, ':a' => $ids[1], ':t' => $now - 3600 * 5]);

        // scores of the last weeks (the scoreboard)
        $sc = $db->prepare("INSERT INTO score_events (class_id, user_id, kind, points, ref, created_at) VALUES (:c, :u, :k, :p, :r, :t)");
        $plan = [[0, 14, 6], [1, 11, 8], [2, 9, 3], [3, 6, 2], [4, 4, 1]];       // user index, quiz answers right, reviews
        foreach ($plan as [$i, $quiz, $rev]) {
            for ($n = 0; $n < $quiz; $n++) $sc->execute([':c' => $cid, ':u' => $ids[$i], ':k' => 'quiz', ':p' => SCORE_QUIZ, ':r' => "demo:q:$n", ':t' => $now - 86400 * (1 + $n % 12)]);
            for ($n = 0; $n < $rev; $n++) $sc->execute([':c' => $cid, ':u' => $ids[$i], ':k' => 'review', ':p' => SCORE_REVIEW, ':r' => "demo:r:$n", ':t' => $now - 86400 * (1 + $n % 9)]);
        }
        $log = $db->prepare('INSERT INTO class_log (class_id, user_id, action, detail, created_at) VALUES (:c, :u, :a, :d, :t)');
        foreach ([['Orario salvato', '', 40], ['Ruolo assegnato', 'Segretario a Marco B.', 39], ['Argomento creato', 'Database relazionali e SQL', 22]] as [$a, $d, $daysAgo]) {
            $log->execute([':c' => $cid, ':u' => $ids[0], ':a' => $a, ':d' => $d, ':t' => $now - 86400 * $daysAgo]);
        }
        appSettingSet($db, 'demo_seed_day', $today);
        $db->exec('COMMIT');
        return true;
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->exec('ROLLBACK');
        throw $e;
    }
}
