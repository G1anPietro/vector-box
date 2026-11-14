<?php
// bin/seed-test-schema.php — adds ONE sample schema ("mappa") to the "Italiano" folder of a class, to try the schema view and
// the delete option. Run once, as the web user:
//   sudo -u www-data php /var/www/vector-box/bin/seed-test-schema.php [class_id]
// It is written as a hand-made document (author = the first site admin), so the AI never rewrites it; delete it from the
// archive (⋯ > Elimina questo documento) when done. Running it again does nothing.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../public/api/database.php';

$db = getDbConnection();
$classId = isset($argv[1]) ? (int)$argv[1] : 0;
$sql = "SELECT s.id AS subject_id, s.class_id, c.name FROM class_subjects s JOIN school_classes c ON c.id = s.class_id
        WHERE LOWER(s.name) = 'italiano' AND c.status = 'active'" . ($classId ? ' AND s.class_id = ' . $classId : '');
$found = $db->query($sql)->fetchAll();
if (count($found) !== 1) {
    fwrite(STDERR, count($found) ? "More than one class has an Italiano subject: pass the class id.\n" : "No active class with an Italiano subject.\n");
    foreach ($found as $f) fwrite(STDERR, "  class {$f['class_id']}: {$f['name']}\n");
    exit(1);
}
$f = $found[0];
$admin = (int)$db->query('SELECT id FROM accounts WHERE is_admin = 1 ORDER BY id LIMIT 1')->fetchColumn();
if ($admin <= 0) { fwrite(STDERR, "No admin account.\n"); exit(1); }

$schema = ['title' => 'Dostoevskij (schema di prova)', 'children' => [
    ['label' => 'Vita', 'children' => [
        ['label' => 'Nascita', 'note' => 'Mosca, **1821**'],
        ['label' => 'Condanna', 'note' => '1849: fucilazione commutata in 4 anni di lavori forzati'],
        ['label' => 'Ultimi anni', 'note' => 'Successo con i grandi romanzi; muore nel 1881']]],
    ['label' => 'Poetica', 'children' => [
        ['label' => 'Dilemma dei personaggi', 'note' => 'ciò che vorrebbero essere e ciò che sono'],
        ['label' => 'Prospettiva polifonica', 'note' => 'niente narratore onnisciente: ogni voce ha il suo peso']]],
    ['label' => 'Opere', 'children' => [
        ['label' => 'Delitto e castigo', 'note' => '1866', 'children' => [['label' => 'Raskolnikov'], ['label' => 'Sonja']]],
        ['label' => 'I fratelli Karamazov', 'note' => '1880']]],
]];
$key = 'manual:schema-prova';
$exists = $db->prepare('SELECT 1 FROM class_docs WHERE class_id = :c AND doc_key = :k');
$exists->execute([':c' => $f['class_id'], ':k' => $key]);
if ($exists->fetchColumn()) { echo "Already there: nothing to do.\n"; exit(0); }
$now = time();
$db->prepare("INSERT INTO class_docs (class_id, doc_key, subject_id, kind, lesson_date, title, content, sources, input_hash, model, status, author_id, created_at, updated_at)
              VALUES (:c, :k, :s, 'schema', :d, 'Schema di prova (Italiano)', :content, '[]', 'manual', 'manual', 'ok', :a, :n, :n)")
   ->execute([':c' => $f['class_id'], ':k' => $key, ':s' => $f['subject_id'], ':d' => date('Y-m-d'),
              ':content' => json_encode($schema, JSON_UNESCAPED_UNICODE), ':a' => $admin, ':n' => $now]);
echo "Added the sample schema to class {$f['class_id']} ({$f['name']}), Italiano.\n";
