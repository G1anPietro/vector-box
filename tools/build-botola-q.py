#!/usr/bin/env python3
"""Builds lib/botola-q.json (the Botola question bank) from two JSON files with the same questions in the same order:
   python3 tools/build-botola-q.py en.json it.json
Each item of the inputs: [difficulty 0|1|2, question, right answer, 3 wrong answers].
Output item: [difficulty, [en...], [it...]]. Source of the questions: Open Trivia DB (opentdb.com), CC BY-SA 4.0."""
import json, sys
en, it = (json.load(open(f)) for f in sys.argv[1:3])
assert len(en) == len(it), 'the two files must have the same length'
for a, b in zip(en, it):
    assert a[0] == b[0] and len(a) == len(b) == 6 and all(isinstance(x, str) and x.strip() for x in a[1:] + b[1:]), (a, b)
    assert len(set(a[2:])) == 4 and len(set(b[2:])) == 4, (a, b)
json.dump([[a[0], a[1:], b[1:]] for a, b in zip(en, it)], open('lib/botola-q.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(en), 'questions')
