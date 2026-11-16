// tests/poker-mano.test.js — poker hand ranking: best five of seven, kickers, ties, the wheel, flush vs straight
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO } = require('./helpers');

const code = `<?php
$src = file_get_contents(${JSON.stringify(path.join(REPO, 'public/api/poker.php'))});
preg_match('/function scoreFive.*?(?=function advanceStage)/s', $src, $m);
eval($m[0]);
$h = fn($a, $b) => evaluateHand($a, $b);
echo json_encode([
  $h(['AH','2D'], ['3C','4S','5H','KD','9C'])['score'],
  $h(['AH','KD'], ['2C','2S','7H','9D','JC'])['score'],
  compareHands($h(['KH','9D'], ['KC','2S','7H','5D','JC'])['key'], $h(['3H','9S'], ['3C','2S','7H','5D','JC'])['key']),
  compareHands($h(['AH','KD'], ['AC','2S','7H','5D','JC'])['key'], $h(['AS','QD'], ['AD','2S','7H','5D','JC'])['key']),
  compareHands($h(['2H','3D'], ['AC','AS','KH','QD','JC'])['key'], $h(['2C','3S'], ['AC','AS','KH','QD','JC'])['key']),
  $h(['2H','9H'], ['3H','5H','KH','4S','6D'])['score'],
  $h(['KH','KD'], ['KC','2S','2H','9D','JC'])['score'],
]);`;

test('poker hands: the wheel, kickers, true ties, flush is not a straight flush, full house', () => {
    const out = JSON.parse(execFileSync('php', ['-r', code.replace(/^<\?php/, '')], { encoding: 'utf8' }));
    assert.deepEqual(out, [4, 1, 1, 1, 0, 5, 6]);
});
