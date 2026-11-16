<?php
// public/api/appunti_pptx.php — a PowerPoint (.pptx) shown as slides in the browser.
// The file is read as XML and drawn again as plain HTML: boxes of text, pictures and simple tables placed where the author put
// them (positions and sizes in the slide's own units, text sizes scaled with the slide width). Everything that is written
// comes out escaped, nothing of the file is passed through, and the page is served with the same sandbox as the HTML notes
// (no script, no request to the outside). It is a preview, not a copy of PowerPoint: animations, theme colours, charts and
// SmartArt are not drawn (their text, when there is some, is in the "Testo" of the file).
require_once __DIR__ . '/appunti_lib.php';

const PPTX_NS = ['a' => 'http://schemas.openxmlformats.org/drawingml/2006/main', 'p' => 'http://schemas.openxmlformats.org/presentationml/2006/main',
                 'r' => 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'rel' => 'http://schemas.openxmlformats.org/package/2006/relationships'];
const PPTX_MAX_SLIDES = 200;
const PPTX_MAX_IMAGE = 4 * 1048576;
const PPTX_MAX_OUT = 24 * 1048576;

function pptxXpath(ZipArchive $z, string $name): ?DOMXPath {
    $xml = notesZipEntry($z, $name);
    if ($xml === false || strlen($xml) > 6 * 1048576) return null;
    $dom = new DOMDocument();
    $prev = libxml_use_internal_errors(true);
    $ok = $dom->loadXML($xml, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);   // no entity loading: no XXE
    libxml_clear_errors(); libxml_use_internal_errors($prev);
    if (!$ok) return null;
    $x = new DOMXPath($dom);
    foreach (PPTX_NS as $k => $v) $x->registerNamespace($k, $v);
    return $x;
}

/** rId => target path (resolved against the folder of the part), from a .rels part. */
function pptxRels(ZipArchive $z, string $part): array {
    $dir = dirname($part);
    $x = pptxXpath($z, $dir . '/_rels/' . basename($part) . '.rels');
    $out = [];
    if (!$x) return $out;
    foreach ($x->query('//rel:Relationship') as $r) {
        $t = (string)$r->getAttribute('Target');
        if ($r->getAttribute('TargetMode') === 'External') continue;
        $path = str_starts_with($t, '/') ? ltrim($t, '/') : $dir . '/' . $t;
        $parts = [];
        foreach (explode('/', $path) as $seg) { if ($seg === '..') array_pop($parts); elseif ($seg !== '.' && $seg !== '') $parts[] = $seg; }
        $out[(string)$r->getAttribute('Id')] = ['path' => implode('/', $parts), 'type' => basename((string)$r->getAttribute('Type'))];
    }
    return $out;
}

/** [x, y, cx, cy] in EMU of a shape (own xfrm, else the placeholder it stands for in the layout or the master), or null. */
function pptxFrame(DOMXPath $x, DOMNode $node, string $xfrmPath, array $inherit): ?array {
    $off = $x->query($xfrmPath . '/a:off', $node)->item(0);
    $ext = $x->query($xfrmPath . '/a:ext', $node)->item(0);
    if ($off && $ext) return [(int)$off->getAttribute('x'), (int)$off->getAttribute('y'), (int)$ext->getAttribute('cx'), (int)$ext->getAttribute('cy')];
    $ph = $x->query('.//p:nvPr/p:ph', $node)->item(0);
    if (!$ph) return null;
    $type = $ph->getAttribute('type'); $idx = $ph->getAttribute('idx');
    foreach ($inherit as $ix) {
        foreach ($ix->query('//p:sp') as $sp) {
            $p2 = $ix->query('.//p:nvPr/p:ph', $sp)->item(0);
            if (!$p2) continue;
            $same = ($idx !== '' && $p2->getAttribute('idx') === $idx) || ($idx === '' && $type !== '' && $p2->getAttribute('type') === $type)
                || ($type === 'ctrTitle' && $p2->getAttribute('type') === 'title') || ($type === 'subTitle' && $p2->getAttribute('type') === 'body');
            if (!$same) continue;
            $o = $ix->query('p:spPr/a:xfrm/a:off', $sp)->item(0); $e = $ix->query('p:spPr/a:xfrm/a:ext', $sp)->item(0);
            if ($o && $e) return [(int)$o->getAttribute('x'), (int)$o->getAttribute('y'), (int)$e->getAttribute('cx'), (int)$e->getAttribute('cy')];
        }
    }
    return null;
}

function pptxColor(DOMXPath $x, ?DOMNode $ctx, string $path): ?string {
    if (!$ctx) return null;
    $c = $x->query($path . '/a:srgbClr/@val', $ctx)->item(0);
    $v = $c ? (string)$c->nodeValue : '';
    return preg_match('/^[0-9A-Fa-f]{6}$/', $v) ? '#' . $v : null;
}

function pptxLuma(string $hex): float {
    return (0.299 * hexdec(substr($hex, 1, 2)) + 0.587 * hexdec(substr($hex, 3, 2)) + 0.114 * hexdec(substr($hex, 5, 2))) / 255;
}

/** One slide as HTML. $state carries the running size of the output. */
function pptxSlideHtml(ZipArchive $z, string $slidePath, int $n, int $cx, int $cy, array &$state): string {
    $x = pptxXpath($z, $slidePath);
    if (!$x) return '';
    $rels = pptxRels($z, $slidePath);
    $inherit = [];
    foreach ($rels as $r) {
        if ($r['type'] !== 'slideLayout') continue;
        if ($lx = pptxXpath($z, $r['path'])) {
            $inherit[] = $lx;
            foreach (pptxRels($z, $r['path']) as $mr) if ($mr['type'] === 'slideMaster' && ($mx = pptxXpath($z, $mr['path']))) $inherit[] = $mx;
        }
    }
    $bg = pptxColor($x, $x->query('//p:cSld/p:bg/p:bgPr')->item(0), 'a:solidFill') ?? '#ffffff';
    $dark = pptxLuma($bg) < 0.45;
    $textDefault = $dark ? '#ffffff' : '#1a1a1a';
    $pct = fn(float $v, int $of) => rtrim(rtrim(sprintf('%.3F', $of > 0 ? $v / $of * 100 : 0), '0'), '.') . '%';
    $esc = fn(string $s) => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

    $paragraphs = function (DOMNode $body, string $phType, float $fontScale) use ($x, $cx, $esc, $textDefault): string {
        $out = '';
        $defaultSz = in_array($phType, ['title', 'ctrTitle'], true) ? 3200 : 1800;
        foreach ($x->query('a:p', $body) as $p) {
            $ppr = $x->query('a:pPr', $p)->item(0);
            $lvl = $ppr ? (int)$ppr->getAttribute('lvl') : 0;
            $algn = $ppr ? $ppr->getAttribute('algn') : '';
            $bullet = $ppr && $x->query('a:buChar', $ppr)->length > 0;
            $marL = $ppr ? max(0, min(6000000, (int)$ppr->getAttribute('marL'))) : 0;
            $html = ''; $maxSz = 0;
            foreach ($x->query('a:r | a:br | a:fld', $p) as $run) {
                if ($run->nodeName === 'a:br') { $html .= '<br>'; continue; }
                $t = (string)$x->evaluate('string(a:t)', $run);
                if ($t === '') continue;
                $rpr = $x->query('a:rPr', $run)->item(0);
                $sz = $rpr && (int)$rpr->getAttribute('sz') > 0 ? (int)$rpr->getAttribute('sz') : $defaultSz;
                $sz = (int)($sz * $fontScale);
                $maxSz = max($maxSz, $sz);
                $style = 'font-size:' . round($sz * 127 / max(1, $cx) * 100, 3) . 'cqw;';
                $col = $rpr ? pptxColor($x, $rpr, 'a:solidFill') : null;
                if ($col) $style .= "color:$col;";
                if ($rpr && $rpr->getAttribute('b') === '1') $style .= 'font-weight:700;';
                if ($rpr && $rpr->getAttribute('i') === '1') $style .= 'font-style:italic;';
                if ($rpr && ($rpr->getAttribute('u') ?: 'none') !== 'none') $style .= 'text-decoration:underline;';
                $html .= '<span style="' . $style . '">' . $esc($t) . '</span>';
            }
            $size = $maxSz ?: (int)($defaultSz * $fontScale);
            $align = ['ctr' => 'center', 'r' => 'right', 'just' => 'justify'][$algn] ?? 'left';
            $indent = $bullet ? ($marL > 0 ? $marL : 285750 * ($lvl + 1)) : $marL;
            $out .= '<p style="text-align:' . $align . ';font-size:' . round($size * 127 / max(1, $cx) * 100, 3) . 'cqw;margin:0 0 .35em ' . round($indent / max(1, $cx) * 100, 3) . 'cqw;'
                  . ($bullet ? 'display:list-item;list-style:disc inside;' : '') . '">' . ($html !== '' ? $html : '&nbsp;') . '</p>';
        }
        return $out;
    };

    $shapes = '';
    $walk = null;
    $walk = function (DOMNode $parent, array $tr) use (&$walk, &$shapes, $x, $z, $rels, $inherit, $pct, $esc, $cx, $cy, $paragraphs, $textDefault, &$state): void {
        foreach ($parent->childNodes as $node) {
            if ($node->nodeType !== XML_ELEMENT_NODE || $state['bytes'] > PPTX_MAX_OUT) continue;
            $name = $node->nodeName;
            if ($name === 'p:grpSp') {
                $off = $x->query('p:grpSpPr/a:xfrm/a:off', $node)->item(0); $ext = $x->query('p:grpSpPr/a:xfrm/a:ext', $node)->item(0);
                $cho = $x->query('p:grpSpPr/a:xfrm/a:chOff', $node)->item(0); $che = $x->query('p:grpSpPr/a:xfrm/a:chExt', $node)->item(0);
                $t2 = $tr;
                if ($off && $ext && $cho && $che && (int)$che->getAttribute('cx') > 0 && (int)$che->getAttribute('cy') > 0) {
                    $sx = (int)$ext->getAttribute('cx') / (int)$che->getAttribute('cx'); $sy = (int)$ext->getAttribute('cy') / (int)$che->getAttribute('cy');
                    $t2 = [$tr[0] + ((int)$off->getAttribute('x') - (int)$cho->getAttribute('x') * $sx) * $tr[2], $tr[1] + ((int)$off->getAttribute('y') - (int)$cho->getAttribute('y') * $sy) * $tr[3], $tr[2] * $sx, $tr[3] * $sy];
                }
                $walk($node, $t2);
                continue;
            }
            if (!in_array($name, ['p:sp', 'p:pic', 'p:graphicFrame', 'p:cxnSp'], true)) continue;
            $xf = $name === 'p:graphicFrame' ? 'p:xfrm' : 'p:spPr/a:xfrm';
            $f = pptxFrame($x, $node, $xf, $inherit);
            if (!$f) continue;
            $left = $tr[0] + $f[0] * $tr[2]; $top = $tr[1] + $f[1] * $tr[3]; $w = $f[2] * $tr[2]; $h = $f[3] * $tr[3];
            $rot = $x->query($xf, $node)->item(0);
            $rotDeg = $rot ? (int)$rot->getAttribute('rot') / 60000 : 0;
            $box = 'left:' . $pct($left, $cx) . ';top:' . $pct($top, $cy) . ';width:' . $pct($w, $cx) . ';height:' . $pct($h, $cy) . ';'
                 . ($rotDeg ? 'transform:rotate(' . round($rotDeg, 2) . 'deg);' : '');

            if ($name === 'p:pic') {
                $rid = (string)$x->evaluate('string(p:blipFill/a:blip/@r:embed)', $node);
                $path = $rels[$rid]['path'] ?? '';
                $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
                $mime = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp'][$ext] ?? '';
                $st = $path !== '' ? $z->statName($path) : false;
                if ($mime && $st && $st['size'] <= PPTX_MAX_IMAGE && $state['images'] + $st['size'] <= PPTX_MAX_OUT / 2) {
                    $bytes = (string)$z->getFromName($path);
                    $state['images'] += strlen($bytes); $state['bytes'] += strlen($bytes) * 4 / 3;
                    $alt = (string)$x->evaluate('string(p:nvPicPr/p:cNvPr/@descr)', $node);
                    $shapes .= '<div class="sh" style="' . $box . '"><img alt="' . $esc($alt) . '" src="data:' . $mime . ';base64,' . base64_encode($bytes) . '"></div>';
                }
                continue;
            }
            if ($name === 'p:graphicFrame') {
                $tbl = $x->query('.//a:tbl', $node)->item(0);
                if (!$tbl) continue;
                $html = '<table>';
                foreach ($x->query('a:tr', $tbl) as $tr2) {
                    $html .= '<tr>';
                    foreach ($x->query('a:tc', $tr2) as $tc) {
                        $text = [];
                        foreach ($x->query('a:txBody/a:p', $tc) as $pp) $text[] = (string)$x->evaluate('string(.)', $pp);
                        $html .= '<td>' . $esc(trim(implode("\n", $text))) . '</td>';
                    }
                    $html .= '</tr>';
                }
                $html .= '</table>';
                $shapes .= '<div class="sh tbl" style="' . $box . '">' . $html . '</div>';
                $state['bytes'] += strlen($html);
                continue;
            }
            // text box / shape
            $fill = pptxColor($x, $x->query('p:spPr', $node)->item(0), 'a:solidFill');
            $body = $x->query('p:txBody', $node)->item(0);
            $inner = '';
            $anchor = 'flex-start';
            if ($body) {
                $bpr = $x->query('a:bodyPr', $body)->item(0);
                $scaleNode = $bpr ? $x->query('a:normAutofit/@fontScale', $bpr)->item(0) : null;
                $fontScale = $scaleNode ? max(0.2, min(1, (float)$scaleNode->nodeValue / 100000)) : 1.0;
                $anchor = ['ctr' => 'center', 'b' => 'flex-end'][$bpr ? $bpr->getAttribute('anchor') : ''] ?? 'flex-start';
                $ph = $x->query('.//p:nvPr/p:ph', $node)->item(0);
                $inner = $paragraphs($body, $ph ? (string)$ph->getAttribute('type') : '', $fontScale);
            }
            if ($inner === '' && !$fill) continue;
            $shapes .= '<div class="sh txt" style="' . $box . ($fill ? "background:$fill;" : '') . 'justify-content:' . $anchor . ';' . '">' . $inner . '</div>';
            $state['bytes'] += strlen($inner) + 200;
        }
    };
    $tree = $x->query('//p:cSld/p:spTree')->item(0);
    if ($tree) $walk($tree, [0, 0, 1, 1]);

    // speaker notes, as text under the slide
    $notes = '';
    foreach ($rels as $r) {
        if ($r['type'] !== 'notesSlide') continue;
        if ($nx = pptxXpath($z, $r['path'])) {
            $lines = [];
            foreach ($nx->query('//p:sp[.//p:ph[@type="body"]]//a:p') as $p) { $t = trim((string)$nx->evaluate('string(.)', $p)); if ($t !== '') $lines[] = $t; }
            if ($lines) $notes = '<div class="notes"><b>Note del relatore</b><br>' . implode('<br>', array_map($esc, $lines)) . '</div>';
        }
    }
    return '<section class="slide-wrap"><div class="slide-n">Slide ' . $n . '</div><div class="sl" style="aspect-ratio:' . $cx . '/' . $cy . ';background:' . $bg . ';color:' . $textDefault . '">'
        . $shapes . '</div>' . $notes . '</section>';
}

/** The whole presentation as a self-contained HTML page, or null if it cannot be read. */
function notesPptxHtml(string $path, string $title = ''): ?string {
    if (!class_exists('DOMDocument') || !class_exists('ZipArchive')) return null;
    $z = new ZipArchive();
    if ($z->open($path, ZipArchive::RDONLY) !== true) return null;
    $pres = pptxXpath($z, 'ppt/presentation.xml');
    if (!$pres) { $z->close(); return null; }
    $sz = $pres->query('//p:sldSz')->item(0);
    $cx = $sz ? (int)$sz->getAttribute('cx') : 9144000;
    $cy = $sz ? (int)$sz->getAttribute('cy') : 6858000;
    if ($cx < 1000 || $cy < 1000) { $cx = 9144000; $cy = 6858000; }
    $rels = pptxRels($z, 'ppt/presentation.xml');
    $slides = [];
    foreach ($pres->query('//p:sldIdLst/p:sldId') as $id) {
        $rid = (string)$id->getAttributeNS(PPTX_NS['r'], 'id');
        if (isset($rels[$rid]) && $rels[$rid]['type'] === 'slide') $slides[] = $rels[$rid]['path'];
    }
    if (!$slides) {   // no usable list: the numbered files in order
        for ($i = 0; $i < $z->numFiles; $i++) if (preg_match('#^ppt/slides/slide(\d+)\.xml$#', (string)$z->getNameIndex($i), $m)) $slides[(int)$m[1]] = $m[0];
        ksort($slides); $slides = array_values($slides);
    }
    $state = ['bytes' => 0, 'images' => 0];
    $html = '';
    foreach (array_slice($slides, 0, PPTX_MAX_SLIDES) as $i => $sp) {
        $html .= pptxSlideHtml($z, $sp, $i + 1, $cx, $cy, $state);
        if ($state['bytes'] > PPTX_MAX_OUT) { $html .= '<p class="cut">La presentazione è molto grande: le altre slide non sono mostrate. Scarica il file per vederle.</p>'; break; }
    }
    $z->close();
    if ($html === '') return null;
    if (count($slides) > PPTX_MAX_SLIDES) $html .= '<p class="cut">Sono mostrate le prime ' . PPTX_MAX_SLIDES . ' slide.</p>';
    $css = 'body{margin:0;padding:.8rem;background:#2b2b30;font-family:system-ui,Calibri,Arial,sans-serif}'
         . '.slide-wrap{max-width:60rem;margin:0 auto 1.2rem}.slide-n{color:#aaa;font:12px system-ui;margin:0 0 .25rem}'
         . '.sl{position:relative;width:100%;container-type:inline-size;overflow:hidden;box-shadow:0 2px 10px #0008;border-radius:3px}'
         . '.sh{position:absolute;box-sizing:border-box;overflow:hidden}.sh img{width:100%;height:100%;object-fit:contain;display:block}'
         . '.txt{display:flex;flex-direction:column;padding:.4cqw .8cqw;line-height:1.2;overflow-wrap:anywhere}.txt p{line-height:1.2}'
         . '.tbl{overflow:auto}.tbl table{border-collapse:collapse;width:100%;font-size:1.6cqw}.tbl td{border:1px solid #888;padding:.3cqw .6cqw;white-space:pre-wrap}'
         . '.notes{color:#ddd;font:13px/1.4 system-ui;margin-top:.4rem}.cut{color:#ddd;font:14px system-ui;text-align:center}';
    return '<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
        . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</title><style>' . $css . '</style></head><body>' . $html . '</body></html>';
}
