<?php
// public/api/classi_ai.php
// Reads a class timetable (and optionally the bell times) from photos or PDFs with Gemini, for api/classi.php.
// The result is only a proposal: the manager reviews it in the editor and saves it.
require_once __DIR__ . '/classi_lib.php';
require_once __DIR__ . '/gemini.php';

const TIMETABLE_AI_MAX_BYTES = 15 * 1048576;
const TIMETABLE_AI_SECONDS = 140;   // nginx gives PHP 180 s on the server
const TIMETABLE_AI_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

const TIMETABLE_AI_PROMPT = <<<'TXT'
Leggi l'orario scolastico settimanale di una classe di scuola superiore italiana dalle immagini o dai PDF ricevuti.
Può esserci anche una seconda immagine con gli orari della campanella (inizio e fine di ogni ora, a volte diversi
per giorno). Rispondi SOLO con JSON in questa forma:
{"periods":{"1":[{"start":"08:10","end":"09:00"}],"2":[]},
 "slots":[{"day":1,"period":1,"subject":"TPSIT","label":"Lab TPSIT","room":"C239 INF2"}],
 "notes":"eventuali dubbi"}
Regole:
- day: 1 = lunedì ... 6 = sabato. period: il numero dell'ora (1 = prima ora).
- Una casella che occupa più ore diventa una voce per ciascuna ora.
- subject: il nome della MATERIA, scritto per intero in italiano quando l'abbreviazione è chiara
  (Matem → Matematica, Ita → Italiano, Inf → Informatica, Ing → Inglese, Sci Mot → Scienze motorie,
  Rel Catt → Religione); senza "Lab": il laboratorio è la stessa materia della teoria.
  Se una materia è già nell'elenco delle materie della classe, usa lo stesso nome.
- label: il testo come è scritto nella casella, solo se è diverso dal nome della materia (es. "Lab TPSIT"), altrimenti "".
- room: l'aula come è scritta (es. "D402"), altrimenti "".
- periods: orari HH:MM a 24 ore, per ogni giorno, presi dagli orari della campanella o scritti accanto alle ore.
  Se gli orari non si vedono da nessuna parte, metti "periods": {}.
- Non inventare caselle che non ci sono. Le ore vuote non vanno messe.
TXT;

function timetableFileType(string $path, string $name): ?string {
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
    return in_array($mime, TIMETABLE_AI_TYPES, true) ? $mime : null;
}

/** Adds hours after the last one of a day until it has $count of them (for times the image didn't show). */
function timetablePadDay(array $day, int $count): array {
    while (count($day) < $count) {
        $last = $day ? end($day)['end'] : '08:00';
        [$h, $m] = array_map('intval', explode(':', $last));
        $start = $h * 60 + $m;
        $end = min($start + 60, 23 * 60 + 59);
        if ($end <= $start) break;
        $day[] = ['start' => sprintf('%02d:%02d', intdiv($start, 60), $start % 60), 'end' => sprintf('%02d:%02d', intdiv($end, 60), $end % 60)];
    }
    return $day;
}

/**
 * Asks Gemini to read the timetable. Returns ['periods' => day => list, 'slots' => [...], 'notes' => string,
 * 'bells_read' => bool] ready for the editor, or an error string. Throws GeminiError when the AI fails.
 */
function timetableFromImages(PDO $db, array $class, array $files): array|string {
    $known = array_column(classSubjects($db, (int)$class['id']), 'name');
    $parts = $files;
    $parts[] = ['text' => 'Materie già presenti nella classe: ' . ($known ? implode(', ', $known) : 'nessuna') . '.'];
    // The browser is waiting: finish (retries and fallback included) well before nginx's timeout
    [$raw, $model] = geminiGenerateAny($db, GEMINI_SMART_CHAIN, TIMETABLE_AI_PROMPT, $parts,
        ['json' => true, 'max_tokens' => 16384, 'deadline' => microtime(true) + (int)envValue('GEMINI_TEST_DEADLINE', (string)TIMETABLE_AI_SECONDS)]);

    $json = json_decode(trim(preg_replace('/^```(?:json)?|```$/m', '', trim($raw)) ?? ''), true);
    if (!is_array($json) || !is_array($json['slots'] ?? null) || !$json['slots']) {
        return 'Non sono riuscito a leggere un orario da questo file: prova con una foto più dritta e nitida.';
    }

    $slots = [];
    $seen = [];
    foreach ($json['slots'] as $s) {
        if (!is_array($s)) continue;
        $day = (int)($s['day'] ?? 0);
        $period = (int)($s['period'] ?? 0);
        $subject = trim((string)($s['subject'] ?? ''));
        if ($day < 1 || $day > CLASS_MAX_DAYS || $period < 1 || $period > CLASS_MAX_PERIODS || $subject === '' || isset($seen["$day:$period"])) continue;
        $seen["$day:$period"] = true;
        $label = trim((string)($s['label'] ?? ''));
        $slots[] = ['day' => $day, 'period' => $period, 'subject' => $subject,
                    'label' => strcasecmp($label, $subject) === 0 ? '' : $label, 'room' => trim((string)($s['room'] ?? ''))];
    }

    // Bell times: the ones read from the image, else the class's current ones; enough hours for every slot
    $current = classPeriods($class);
    $readBells = false;
    $periods = [];
    for ($d = 1; $d <= CLASS_MAX_DAYS; $d++) {
        $aiDay = $json['periods'][(string)$d] ?? $json['periods'][$d] ?? null;
        $parsed = is_array($aiDay) && $aiDay ? classParseDayPeriods(array_map(fn($p) => is_array($p) ? $p : [], $aiDay), "Day $d") : null;
        if (is_array($parsed)) $readBells = true;
        $day = is_array($parsed) ? $parsed : ($current[(string)$d] ?? []);
        $need = max([0, ...array_map(fn($s) => $s['day'] === $d ? $s['period'] : 0, $slots)]);
        $periods[(string)$d] = timetablePadDay($need === 0 && !is_array($parsed) ? [] : $day, $need);
    }

    $checkedPeriods = classParsePeriods($periods);
    if (is_string($checkedPeriods)) return 'Gli orari letti non tornano (' . $checkedPeriods . '): correggili a mano.';
    $checkedSlots = classParseSlots($slots, $checkedPeriods);
    if (is_string($checkedSlots)) return 'L\'orario letto non torna (' . $checkedSlots . '): prova con un\'altra foto.';

    return [
        'periods' => $checkedPeriods,
        'slots' => $checkedSlots,
        'notes' => textCut(trim((string)($json['notes'] ?? '')), 500),
        'bells_read' => $readBells,
        'model' => $model,
    ];
}
