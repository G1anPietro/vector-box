<?php
// public/api/pdf_lib.php — a small PDF writer (no libraries): headings, wrapped text, monospace blocks and JPEG/PNG images.
// Used for the single "Per AI" PDF of the class notes: prompts, texts and the original photos in one file that any AI can read.
// Text is written in the PDF standard fonts (Helvetica, Courier) with WinAnsi encoding: Italian accents are fine; characters outside
// it (emoji, CJK) become "?". Images: JPEG as is; PNG (8-bit, not interlaced, no alpha) re-wrapped; anything else is left out.

final class SimplePdf {
    private const W = 595.28;
    private const H = 841.89;
    private const M = 52.0;
    /** Helvetica widths (1/1000 em) for ASCII 32..126 */
    private const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
        1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
        333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
    private const CP1252 = [0x20AC => 0x80, 0x201A => 0x82, 0x0192 => 0x83, 0x201E => 0x84, 0x2026 => 0x85, 0x2020 => 0x86, 0x2021 => 0x87, 0x02C6 => 0x88,
        0x2030 => 0x89, 0x0160 => 0x8A, 0x2039 => 0x8B, 0x0152 => 0x8C, 0x017D => 0x8E, 0x2018 => 0x91, 0x2019 => 0x92, 0x201C => 0x93, 0x201D => 0x94,
        0x2022 => 0x95, 0x2013 => 0x96, 0x2014 => 0x97, 0x02DC => 0x98, 0x2122 => 0x99, 0x0161 => 0x9A, 0x203A => 0x9B, 0x0153 => 0x9C, 0x017E => 0x9E, 0x0178 => 0x9F,
        0x2192 => 0x3E, 0x2190 => 0x3C, 0x2713 => 0x2A, 0x00A0 => 0x20];

    private array $objects = [];     // id => string (object body without "n 0 obj")
    private array $pages = [];       // content streams
    private string $cur = '';
    private float $y;
    private array $images = [];      // name => object id
    private array $pageImages = [];  // per page: names used
    private array $curImages = [];
    private int $nextId = 5;         // 1 catalog, 2 pages, 3 helvetica, 4 helvetica-bold, 5 courier (set in __construct)

    public function __construct() {
        $this->nextId = 6;
        $this->newPage();
    }

    /** UTF-8 -> WinAnsi bytes */
    public static function encode(string $s): string {
        $out = '';
        if (!preg_match_all('/./us', $s, $m)) return preg_replace('/[^\x20-\x7E]/', '?', $s) ?? '';
        foreach ($m[0] as $ch) {
            $cp = self::cp($ch);
            if ($cp === 9) $out .= '    ';
            elseif ($cp === 10 || $cp === 13) $out .= ' ';
            elseif ($cp >= 0x20 && $cp <= 0x7E) $out .= chr($cp);
            elseif ($cp >= 0xA1 && $cp <= 0xFF) $out .= chr($cp);
            elseif (isset(self::CP1252[$cp])) $out .= chr(self::CP1252[$cp]);
            else $out .= '?';
        }
        return $out;
    }

    private static function cp(string $ch): int {
        $b = array_map('ord', str_split($ch));
        return match (count($b)) { 1 => $b[0], 2 => (($b[0] & 0x1F) << 6) | ($b[1] & 0x3F), 3 => (($b[0] & 0x0F) << 12) | (($b[1] & 0x3F) << 6) | ($b[2] & 0x3F), default => 0x3F };
    }

    private function width(string $bytes, float $size, bool $mono): float {
        if ($mono) return strlen($bytes) * 0.6 * $size;
        $w = 0;
        foreach (str_split($bytes) as $c) { $o = ord($c); $w += ($o >= 32 && $o <= 126) ? self::HELV[$o - 32] : 556; }
        return $w * $size / 1000 * 1.04;   // a little room: bold and unusual letters are wider
    }

    private function newPage(): void {
        if ($this->cur !== '' || $this->pages) $this->closePage();
        $this->cur = '';
        $this->curImages = [];
        $this->y = self::H - self::M;
    }

    private function closePage(): void {
        $this->pages[] = $this->cur;
        $this->pageImages[] = $this->curImages;
    }

    private function esc(string $b): string { return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $b); }

    /** One line of text at the cursor. font: F1 helvetica, F2 bold, F3 courier */
    private function line(string $utf8, string $font, float $size, float $indent = 0.0): void {
        $lead = $size * 1.32;
        if ($this->y - $lead < self::M) $this->newPage();
        $this->y -= $lead;
        $this->cur .= sprintf("BT /%s %.2f Tf %.2f %.2f Td (%s) Tj ET\n", $font, $size, self::M + $indent, $this->y, $this->esc(self::encode($utf8)));
    }

    /** Wraps $text to the page width and writes it. */
    private function wrapped(string $text, string $font, float $size, float $indent = 0.0, bool $mono = false): void {
        $max = self::W - 2 * self::M - $indent;
        foreach (preg_split('/\R/u', $text) as $para) {
            if (trim($para) === '') { $this->y -= $size * 0.6; continue; }
            $cur = '';
            foreach (preg_split('/(\s+)/u', $para, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY) as $tok) {
                $try = $cur . $tok;
                if ($cur !== '' && $this->width(self::encode($try), $size, $mono) > $max) {
                    $this->line(rtrim($cur), $font, $size, $indent);
                    $cur = ltrim($tok);
                    // a single word longer than the line is cut
                    while ($this->width(self::encode($cur), $size, $mono) > $max && mb_strlen($cur) > 1) {
                        $cut = max(1, (int)(mb_strlen($cur) * $max / $this->width(self::encode($cur), $size, $mono)) - 1);
                        $this->line(mb_substr($cur, 0, $cut), $font, $size, $indent);
                        $cur = mb_substr($cur, $cut);
                    }
                } else $cur = $try;
            }
            if (trim($cur) !== '') $this->line(rtrim($cur), $font, $size, $indent);
        }
    }

    public function heading(string $text, int $level = 1): void {
        $size = [1 => 18, 2 => 14, 3 => 12][$level] ?? 12;
        $this->y -= $size * 0.7;
        if ($this->y < self::M + 60) $this->newPage();
        $this->wrapped($text, 'F2', $size);
        $this->y -= 3;
    }

    public function para(string $text): void { $this->wrapped($text, 'F1', 10.5); $this->y -= 3; }

    public function code(string $text): void { $this->wrapped($text, 'F3', 8.6, 8, true); $this->y -= 4; }

    /** Adds an image if it is a JPEG or a plain PNG; returns false when it was left out. */
    public function image(string $bytes, float $maxH = 520.0): bool {
        $im = $this->parseImage($bytes);
        if (!$im) return false;
        $boxW = self::W - 2 * self::M;
        $scale = min($boxW / $im['w'], $maxH / $im['h'], 1.6);
        $w = $im['w'] * $scale; $h = $im['h'] * $scale;
        if ($this->y - $h < self::M) $this->newPage();
        $name = 'Im' . (count($this->images) + 1);
        $id = $this->nextId++;
        $this->objects[$id] = $im['obj'];
        $this->images[$name] = $id;
        $this->curImages[] = $name;
        $this->y -= $h;
        $this->cur .= sprintf("q %.2f 0 0 %.2f %.2f %.2f cm /%s Do Q\n", $w, $h, self::M, $this->y, $name);
        $this->y -= 8;
        return true;
    }

    private function parseImage(string $b): ?array {
        if (strlen($b) < 24) return null;
        if (str_starts_with($b, "\xFF\xD8")) {      // JPEG: find the frame header
            for ($i = 2; $i + 9 < strlen($b);) {
                if ($b[$i] !== "\xFF") { $i++; continue; }
                $m = ord($b[$i + 1]);
                if ($m >= 0xC0 && $m <= 0xCF && !in_array($m, [0xC4, 0xC8, 0xCC], true)) {
                    $h = (ord($b[$i + 5]) << 8) | ord($b[$i + 6]);
                    $w = (ord($b[$i + 7]) << 8) | ord($b[$i + 8]);
                    $n = ord($b[$i + 9]);
                    $cs = $n === 1 ? '/DeviceGray' : ($n === 4 ? '/DeviceCMYK' : '/DeviceRGB');
                    $dec = $n === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
                    if ($w < 1 || $h < 1 || $m === 0xC2) return null;   // progressive JPEGs are accepted by most readers but not all: leave out
                    return ['w' => $w, 'h' => $h, 'obj' => "<< /Type /XObject /Subtype /Image /Width $w /Height $h /ColorSpace $cs /BitsPerComponent 8 /Filter /DCTDecode$dec /Length " . strlen($b) . " >>\nstream\n$b\nendstream"];
                }
                $len = (ord($b[$i + 2]) << 8) | ord($b[$i + 3]);
                $i += 2 + max(2, $len);
            }
            return null;
        }
        if (str_starts_with($b, "\x89PNG\r\n\x1A\n")) {   // PNG: the compressed data goes in as is (Predictor 15)
            $w = unpack('N', substr($b, 16, 4))[1]; $h = unpack('N', substr($b, 20, 4))[1];
            $depth = ord($b[24]); $type = ord($b[25]); $interlace = ord($b[28]);
            if ($depth !== 8 || !in_array($type, [0, 2], true) || $interlace !== 0) return null;
            $data = ''; $pos = 8;
            while ($pos + 8 <= strlen($b)) {
                $len = unpack('N', substr($b, $pos, 4))[1]; $kind = substr($b, $pos + 4, 4);
                if ($kind === 'IDAT') $data .= substr($b, $pos + 8, $len);
                if ($kind === 'IEND') break;
                $pos += 12 + $len;
            }
            if ($data === '') return null;
            $cols = $type === 0 ? 1 : 3;
            return ['w' => $w, 'h' => $h, 'obj' => "<< /Type /XObject /Subtype /Image /Width $w /Height $h /ColorSpace " . ($type === 0 ? '/DeviceGray' : '/DeviceRGB')
                . " /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors $cols /BitsPerComponent 8 /Columns $w >> /Length " . strlen($data) . " >>\nstream\n$data\nendstream"];
        }
        return null;
    }

    /** The finished PDF file. */
    public function output(): string {
        $this->closePage();
        $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        $emit = function (int $id, string $body) use (&$out, &$offsets) { $offsets[$id] = strlen($out); $out .= "$id 0 obj\n$body\nendobj\n"; };
        $fonts = [3 => 'Helvetica', 4 => 'Helvetica-Bold', 5 => 'Courier'];
        foreach ($fonts as $id => $name) $emit($id, "<< /Type /Font /Subtype /Type1 /BaseFont /$name /Encoding /WinAnsiEncoding >>");
        foreach ($this->objects as $id => $body) $emit($id, $body);
        $pageIds = [];
        foreach ($this->pages as $i => $content) {
            $cid = $this->nextId++; $pid = $this->nextId++;
            $z = function_exists('gzcompress') ? gzcompress($content, 6) : false;
            $emit($cid, $z !== false ? "<< /Filter /FlateDecode /Length " . strlen($z) . " >>\nstream\n$z\nendstream" : "<< /Length " . strlen($content) . " >>\nstream\n$content\nendstream");
            $xo = '';
            foreach (array_unique($this->pageImages[$i]) as $name) $xo .= " /$name {$this->images[$name]} 0 R";
            $emit($pid, sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>%s >> /Contents %d 0 R >>",
                self::W, self::H, $xo !== '' ? " /XObject <<$xo >>" : '', $cid));
            $pageIds[] = $pid;
        }
        $emit(2, '<< /Type /Pages /Kids [' . implode(' ', array_map(fn($p) => "$p 0 R", $pageIds)) . '] /Count ' . count($pageIds) . ' >>');
        $emit(1, '<< /Type /Catalog /Pages 2 0 R >>');
        $max = max(array_keys($offsets));
        $xref = strlen($out);
        $out .= "xref\n0 " . ($max + 1) . "\n0000000000 65535 f \n";
        for ($i = 1; $i <= $max; $i++) $out .= isset($offsets[$i]) ? sprintf("%010d 00000 n \n", $offsets[$i]) : "0000000000 65535 f \n";
        $out .= "trailer\n<< /Size " . ($max + 1) . " /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n";
        return $out;
    }
}
