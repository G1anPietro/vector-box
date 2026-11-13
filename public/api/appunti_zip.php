<?php
// public/api/appunti_zip.php
// "Scarica tutto (.zip)": the original material of a lesson day, a subject or a test period, with typed texts,
// transcriptions, the AI documents, an index of who wrote what, and a PROMPT.txt to use the material with any AI
// (ChatGPT, Claude, Gemini...) by hand. The result can be uploaded back with "Carica un documento".
require_once __DIR__ . '/appunti_ai.php';

const ZIP_MAX_BYTES = 300 * 1048576;

/** File/folder name safe for every system. */
function zipName(string $s, int $max = 60): string {
    $s = preg_replace('/[\\\\\/:*?"<>|\x00-\x1F]+/u', '-', $s) ?? '';
    $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '', " .-");
    return $s === '' ? 'senza-nome' : textCut($s, $max);
}

/** The AI prompts, reworded for an AI that receives the material as attached files. */
function zipPrompt(string $prompt): string {
    return preg_replace('/Il materiale è tra <materiale> e <\/materiale>[.:]/u',
        'Il materiale è nei file allegati (INDICE.txt dice chi ha scritto cosa e i numeri delle fonti).', $prompt) ?? $prompt;
}

/**
 * Builds the zip in a temporary file. $scope: ['type' => 'day'|'subject'|'event', ...]. Returns [path, download name]
 * or an error string (nothing to download, too big).
 */
function zipBuild(PDO $db, array $class, array $scope): array|string {
    $classId = (int)$class['id'];
    $where = ['i.class_id = :c'];
    $params = [':c' => $classId];
    $event = null;
    if ($scope['type'] === 'event') {
        $st = $db->prepare('SELECT e.*, s.name AS subject FROM class_events e JOIN class_subjects s ON s.id = e.subject_id WHERE e.id = :id AND e.class_id = :c');
        $st->execute([':id' => $scope['event_id'], ':c' => $classId]);
        $event = $st->fetch();
        if (!$event) return 'Verifica non trovata.';
        [$from, $to] = notesEventPeriod($db, $event);
        $where[] = 'i.subject_id = :s AND i.lesson_date BETWEEN :f AND :t';
        $params += [':s' => $event['subject_id'], ':f' => $from, ':t' => $to];
    } elseif ($scope['type'] === 'day') {
        $where[] = 'i.lesson_date = :d';
        $params[':d'] = $scope['date'];
        if (!empty($scope['subject_id'])) { $where[] = 'i.subject_id = :s'; $params[':s'] = $scope['subject_id']; }
    } else {
        $where[] = 'i.subject_id = :s';
        $params[':s'] = $scope['subject_id'];
    }
    $st = $db->prepare('SELECT i.*, a.username AS author, s.name AS subject FROM class_items i
                        LEFT JOIN accounts a ON a.id = i.author_id JOIN class_subjects s ON s.id = i.subject_id
                        WHERE ' . implode(' AND ', $where) . ' ORDER BY i.lesson_date, i.subject_id, i.id');
    $st->execute($params);
    $items = $st->fetchAll();
    if (!$items) return 'Non c\'è materiale da scaricare qui.';

    $fileSt = $db->prepare('SELECT * FROM class_item_files WHERE item_id = :i ORDER BY id');
    $total = 0;
    $filesOf = [];
    foreach ($items as $it) {
        $fileSt->execute([':i' => $it['id']]);
        $filesOf[$it['id']] = $fileSt->fetchAll();
        foreach ($filesOf[$it['id']] as $f) $total += (int)$f['size'];
    }
    if ($total > ZIP_MAX_BYTES) return 'Troppo materiale per un solo zip (' . round($total / 1048576) . ' MB): scegli un giorno o una materia.';

    $tmpDir = dirname(__DIR__, 2) . '/data/tmp';
    if (!is_dir($tmpDir)) @mkdir($tmpDir, 0750, true);
    foreach (glob($tmpDir . '/zip-*') ?: [] as $old) { if (filemtime($old) < time() - 3600) @unlink($old); }
    $path = $tmpDir . '/zip-' . bin2hex(random_bytes(8)) . '.zip';
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::EXCL) !== true) throw new RuntimeException('cannot create zip');

    $index = [];
    $subjects = [];
    foreach (array_values($items) as $n => $it) {
        $num = $n + 1;
        $subjects[$it['subject']] = true;
        $dir = 'materiale/' . $it['lesson_date'] . ' ' . zipName($it['subject'], 40) . '/'
             . sprintf('%02d', $num) . ' ' . zipName(($it['author'] ?? '?') . ' - ' . (AI_KIND_LABELS[$it['kind']] ?? $it['kind']), 60) . '/';
        $zip->addEmptyDir(rtrim($dir, '/'));
        $line = "[$num] " . (AI_KIND_LABELS[$it['kind']] ?? $it['kind']) . ' di ' . ($it['author'] ?? '?') . ' — ' . $it['subject']
              . ', ' . $it['lesson_date'] . ($it['period'] ? ", {$it['period']}ª ora" : '') . ($it['title'] !== '' ? " — {$it['title']}" : '');
        $contents = [];
        if (trim($it['body']) !== '') {
            $zip->addFromString($dir . 'testo.txt', ($it['title'] !== '' ? $it['title'] . "\n\n" : '') . $it['body'] . "\n");
            $contents[] = 'testo.txt';
        }
        $used = [];
        foreach ($filesOf[$it['id']] as $f) {
            $name = zipName($f['original_name'], 80);
            while (isset($used[$name])) $name = '1-' . $name;
            $used[$name] = true;
            $src = notesDir($classId) . '/' . basename($f['stored_name']);
            if (is_file($src)) {
                $zip->addFile($src, $dir . $name);
                // photos and PDFs are already compressed
                if (str_starts_with($f['mime'], 'image/') || $f['mime'] === 'application/pdf') $zip->setCompressionName($dir . $name, ZipArchive::CM_STORE);
                $contents[] = $name;
            }
            if ($f['text_status'] === 'done' && $f['text'] !== null && !preg_match('/\.(txt|md)$/i', $name)) {
                $zip->addFromString($dir . 'trascrizione - ' . $name . '.txt', $f['text'] . "\n");
                $contents[] = 'trascrizione - ' . $name . '.txt';
            }
        }
        $index[] = $line . "\n    " . rtrim($dir, '/') . ': ' . implode(', ', $contents);
    }

    // AI documents of the same scope (written by the site, or uploaded by hand)
    $dw = ['d.class_id = :c', "d.status = 'ok'"];
    $dp = [':c' => $classId];
    if ($event) { $dw[] = 'd.event_id = :e'; $dp[':e'] = $event['id']; }
    else {
        $dw[] = "d.kind = 'lezione'";
        if ($scope['type'] === 'day') { $dw[] = 'd.lesson_date = :d'; $dp[':d'] = $scope['date']; }
        if (!empty($scope['subject_id'])) { $dw[] = 'd.subject_id = :s'; $dp[':s'] = $scope['subject_id']; }
    }
    $ds = $db->prepare('SELECT d.*, a.username AS author FROM class_docs d LEFT JOIN accounts a ON a.id = d.author_id WHERE ' . implode(' AND ', $dw) . ' ORDER BY d.lesson_date, d.id');
    $ds->execute($dp);
    foreach ($ds->fetchAll() as $d) {
        $name = zipName($d['title'] . ($d['author'] ? ' (di ' . $d['author'] . ')' : ''), 90) . ($d['kind'] === 'quiz' ? '.json' : '.md');
        $zip->addFromString('documenti-ai/' . $name, $d['kind'] === 'quiz' ? $d['content'] : "# {$d['title']}\n\n{$d['content']}\n");
    }

    // Index and prompt
    $what = $event
        ? (($event['kind'] === 'interrogazione' ? 'Interrogazione' : 'Verifica') . " di {$event['subject']} del "
            . (new DateTimeImmutable($event['event_date']))->format('d/m/Y') . ($event['title'] !== '' ? " ({$event['title']})" : ''))
        : implode(', ', array_keys($subjects)) . ($scope['type'] === 'day' ? ' — ' . (new DateTimeImmutable($scope['date']))->format('d/m/Y') : '');
    $zip->addFromString('INDICE.txt', "Classe {$class['name']} ({$class['school']}) — $what\nFonti:\n\n" . implode("\n\n", $index) . "\n");
    $zip->addFromString('PROMPT.txt', zipPromptText($class, $what, $event));
    $zip->close();

    $download = zipName("Appunti {$class['name']} - $what", 100) . '.zip';
    return [$path, $download];
}

function zipPromptText(array $class, string $what, ?array $event): string {
    $intro = "COME USARLO\n"
        . "1. Apri un'AI che accetta file (ChatGPT, Claude, Gemini, Copilot...).\n"
        . "2. Allega i file della cartella \"materiale\" e INDICE.txt (se l'AI accetta lo zip intero, va bene anche quello).\n"
        . "3. Copia e incolla il PROMPT 1 qui sotto. Gli altri prompt mandali dopo, nella stessa chat.\n"
        . "4. Copia la risposta e caricala su vector-box: Appunti di classe → Studio → \"Carica un documento fatto con un'altra AI\",\n"
        . "   scegliendo il tipo giusto (il quiz va caricato così com'è, in JSON).\n"
        . "Nota: l'AI può sbagliare. Controlla sempre con il libro e gli appunti originali.\n\n"
        . "Classe {$class['name']} ({$class['school']}). $what.\n"
        . ($event && $event['topics'] !== '' ? "Argomenti annunciati dal prof: {$event['topics']}\n" : '');
    if (!$event) {
        return $intro . "\n===== PROMPT 1 — appunti completi =====\n\n" . zipPrompt(AI_PROMPT_LESSON) . "\n";
    }
    return $intro
        . "\n===== PROMPT 1 — dispensa completa =====\n\n" . zipPrompt(AI_PROMPT_COMPLETO)
        . "\n\n===== PROMPT 2 — riassunto =====\n\n" . "Dalla dispensa che hai appena scritto:\n" . AI_PROMPT_RIASSUNTO
        . "\n\n===== PROMPT 3 — preparazione mirata =====\n\n" . "Dalla dispensa che hai appena scritto e dai file di tipo \"Domande del prof\" e \"Verifica di preparazione\":\n" . AI_PROMPT_PREPARAZIONE
        . "\n\n===== PROMPT 4 — quiz (JSON) =====\n\n" . "Dalla dispensa che hai appena scritto:\n" . AI_PROMPT_QUIZ . "\n";
}
