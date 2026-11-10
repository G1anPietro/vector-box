<?php
// public/api/epub_meta.php
// EPUB metadata/cover extraction (shared by upload and the one-time catalog repair).

const EPUB_MAX_XML_BYTES   = 2 * 1024 * 1024;   // container.xml / .opf
const EPUB_MAX_COVER_BYTES = 10 * 1024 * 1024;  // guards against zip bombs

function epubReadEntry(ZipArchive $zip, string $name, int $maxBytes): ?string {
    $stat = $zip->statName($name);
    if (!$stat || $stat['size'] > $maxBytes) {
        return null;
    }
    $data = $zip->getFromName($name);
    return $data === false ? null : $data;
}

/**
 * @return array{title:?string, author:?string, cover_data:?string, cover_ext:?string}
 */
function readEpubMetadata(string $epubPath): array {
    $meta = ['title' => null, 'author' => null, 'cover_data' => null, 'cover_ext' => null];

    if (!class_exists('ZipArchive')) {
        return $meta;
    }

    $zip = new ZipArchive();
    if ($zip->open($epubPath) !== true) {
        return $meta;
    }

    $prevErrors = libxml_use_internal_errors(true);
    try {
        $containerXml = epubReadEntry($zip, 'META-INF/container.xml', EPUB_MAX_XML_BYTES);
        $container = $containerXml ? simplexml_load_string($containerXml, 'SimpleXMLElement', LIBXML_NONET) : false;
        $opfPath = $container ? (string)($container->rootfiles->rootfile['full-path'] ?? '') : '';
        if ($opfPath === '') {
            return $meta;
        }

        $opfContent = epubReadEntry($zip, $opfPath, EPUB_MAX_XML_BYTES);
        $opf = $opfContent ? simplexml_load_string($opfContent, 'SimpleXMLElement', LIBXML_NONET) : false;
        if (!$opf) {
            return $meta;
        }
        $opf->registerXPathNamespace('dc', 'http://purl.org/dc/elements/1.1/');

        $titleNodes = $opf->xpath('//dc:title');
        if (!empty($titleNodes) && trim((string)$titleNodes[0]) !== '') {
            $meta['title'] = trim((string)$titleNodes[0]);
        }

        $creatorNodes = $opf->xpath('//dc:creator');
        if (!empty($creatorNodes) && trim((string)$creatorNodes[0]) !== '') {
            $meta['author'] = trim((string)$creatorNodes[0]);
        }

        // OPF files declare a default namespace, so unprefixed XPath ("//meta") matches nothing:
        // use local-name() to stay namespace-agnostic.
        $coverHref = [];
        $metaCover = $opf->xpath('//*[local-name()="meta"][@name="cover"]/@content');
        if (!empty($metaCover)) {
            $coverId = (string)$metaCover[0];
            // The id is attacker-controlled and goes into an XPath expression: allow only id-safe characters
            if (preg_match('/^[A-Za-z0-9_.\-:]+$/', $coverId)) {
                $coverHref = $opf->xpath("//*[local-name()='item'][@id='{$coverId}']/@href") ?: [];
            }
        }
        if (empty($coverHref)) {
            // EPUB 3: <item properties="cover-image" href="..."/>
            $coverHref = $opf->xpath('//*[local-name()="item"][contains(concat(" ", @properties, " "), " cover-image ")]/@href') ?: [];
        }

        if (!empty($coverHref)) {
            $opfDir = dirname($opfPath);
            $opfDir = ($opfDir === '.') ? '' : $opfDir . '/';
            // Resolve the href inside the zip and refuse path traversal outside it
            $coverPathInZip = $opfDir . rawurldecode((string)$coverHref[0]);
            if (strpos($coverPathInZip, '..') === false) {
                $coverData = epubReadEntry($zip, $coverPathInZip, EPUB_MAX_COVER_BYTES);
                if ($coverData !== null && $coverData !== '') {
                    $ext = strtolower(pathinfo($coverPathInZip, PATHINFO_EXTENSION));
                    $meta['cover_ext'] = in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'], true) ? $ext : 'jpg';
                    $meta['cover_data'] = $coverData;
                }
            }
        }
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($prevErrors);
        $zip->close();
    }

    return $meta;
}
