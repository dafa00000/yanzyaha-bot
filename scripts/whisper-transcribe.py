#!/usr/bin/env python3
"""
Whisper transcription for yanzyaha-bot autoclip.
Uses faster-whisper (CTranslate2-based, ~4x faster than openai-whisper).

Output: JSON to stdout with shape:
{
  "language": "id",
  "segments": [
    {"start": 0.5, "end": 4.2, "text": "...", "words": [{"word": "...", "start": 0.5, "end": 0.9}, ...]},
    ...
  ]
}

Usage:
  python3 whisper-transcribe.py <video_or_audio_path> [--model small] [--lang id] [--task transcribe]
"""
import sys
import json
import argparse
import os
import warnings
warnings.filterwarnings("ignore")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", help="Path to video/audio file")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"),
                        choices=["tiny", "base", "small", "medium", "large-v3", "large-v2"],
                        help="Whisper model size (default: small)")
    parser.add_argument("--lang", default=os.environ.get("WHISPER_LANG", "id"),
                        help="Language code (default: id — Indonesian)")
    parser.add_argument("--task", default="transcribe", choices=["transcribe", "translate"],
                        help="transcribe (same lang) or translate (to English)")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"],
                        help="Device (default: auto — cuda if available)")
    parser.add_argument("--compute-type", default="auto",
                        help="Compute type (default: auto). int8 = fastest on CPU")
    args = parser.parse_args()

    if not os.path.isfile(args.video):
        print(json.dumps({"error": f"File not found: {args.video}"}), file=sys.stdout)
        sys.exit(1)

    # Import after arg parse (so --help works without faster-whisper installed)
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "error": "faster-whisper not installed. Run: pip install faster-whisper"
        }), file=sys.stdout)
        sys.exit(1)

    # Device selection
    device = args.device
    if device == "auto":
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

    # Compute type
    compute_type = args.compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    print(f"[WHISPER] model={args.model} lang={args.lang} device={device} compute={compute_type}", file=sys.stderr)

    try:
        model = WhisperModel(args.model, device=device, compute_type=compute_type)
    except Exception as e:
        print(json.dumps({"error": f"Model load failed: {e}"}), file=sys.stdout)
        sys.exit(1)

    # Transcribe with word-level timestamps
    try:
        segments_iter, info = model.transcribe(
            args.video,
            language=args.lang if args.lang else None,
            task=args.task,
            beam_size=5,
            vad_filter=True,           # skip silence
            vad_parameters={"min_silence_duration_ms": 500},
            word_timestamps=True,      # ← KEY: per-word timing for accurate subtitles
            condition_on_previous_text=False,  # avoids hallucination loops
        )
        segments = []
        for seg in segments_iter:
            words = []
            if seg.words:
                for w in seg.words:
                    words.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "prob": round(w.probability, 3),
                    })
            segments.append({
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
                "words": words,
            })
        result = {
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 3),
            "segments": segments,
        }
        print(json.dumps(result, ensure_ascii=False), file=sys.stdout)
    except Exception as e:
        print(json.dumps({"error": f"Transcription failed: {e}"}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
