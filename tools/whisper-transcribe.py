#!/usr/bin/env python3
"""Transcribe one audio file with faster-whisper (local, no internet) and print the text on stdout.

Used by bin/appunti-whisper.php for the class notes. Install on the server (see docs/DEPLOY.md):
    python3 -m venv /opt/vector-box-whisper && /opt/vector-box-whisper/bin/pip install faster-whisper
and ffmpeg. Environment: WHISPER_MODEL (default "small"; "base" is faster, "medium" more accurate),
WHISPER_LANGUAGE (default "it"), WHISPER_THREADS (default: all cores).
"""
import os
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: whisper-transcribe.py AUDIO_FILE", file=sys.stderr)
        return 2
    from faster_whisper import WhisperModel  # imported here so --help-like errors stay fast

    model = WhisperModel(
        os.environ.get("WHISPER_MODEL", "small"),
        device="cpu",
        compute_type="int8",
        cpu_threads=int(os.environ.get("WHISPER_THREADS", "0") or 0),
        download_root=os.environ.get("WHISPER_MODELS_DIR") or None,
    )
    segments, _info = model.transcribe(
        sys.argv[1],
        language=os.environ.get("WHISPER_LANGUAGE", "it") or None,
        vad_filter=True,          # skip silences (long pauses in class)
        beam_size=5,
    )
    # One paragraph per pause longer than 2 seconds, so the text is readable
    out, last_end = [], None
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        if last_end is not None and seg.start - last_end > 2.0:
            out.append("\n\n")
        elif out:
            out.append(" ")
        out.append(text)
        last_end = seg.end
    sys.stdout.write("".join(out).strip() + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
