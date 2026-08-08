# -*- coding: utf-8 -*-
"""High-accuracy re-transcription after class.

During class the small model is used to keep up in real time (measured RTF 0.37 here, fast enough but with some typos).
After class there's no real-time pressure, so large-v3-turbo re-runs the saved audio.wav,
reusing the speakers and segmentation already produced in class and only swapping the text for a more accurate version.

An hour-long class takes about 1.5-2 hours (RTF 1.86); best left running overnight.

Usage:
    python retranscribe.py                     # process the latest class
    python retranscribe.py \"..\\records\\2026-07-27_1405_Advanced-Math\"
    python retranscribe.py --model medium      # use medium for even better accuracy
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))


def latest_record(root):
    dirs = [os.path.join(root, d) for d in os.listdir(root)
            if os.path.isdir(os.path.join(root, d))]
    dirs = [d for d in dirs if os.path.exists(os.path.join(d, "transcript.jsonl"))]
    if not dirs:
        sys.exit(f"{root} 下没有找到课堂记录")
    return max(dirs, key=os.path.getmtime)


def ts(sec):
    s = int(sec)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("record", nargs="?", help="课堂记录目录，省略则取最新一节")
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--threads", type=int, default=6)
    args = ap.parse_args()

    with open(os.path.join(HERE, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)

    rec_dir = args.record or latest_record(
        os.path.normpath(os.path.join(HERE, cfg["server"]["records_dir"])))
    wav = os.path.join(rec_dir, "audio.wav")
    jl = os.path.join(rec_dir, "transcript.jsonl")
    if not os.path.exists(wav):
        sys.exit(f"没有 audio.wav，无法重转写（config 里 save_wav 是不是关了？）\n{rec_dir}")

    lines = [json.loads(l) for l in open(jl, encoding="utf-8") if l.strip()]
    audio, sr = sf.read(wav, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    print(f"记录: {rec_dir}")
    print(f"音频: {len(audio)/sr/60:.1f} 分钟，共 {len(lines)} 句")
    print(f"模型: {args.model}（会比课上慢很多，请耐心）\n")

    from faster_whisper import WhisperModel
    t0 = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=args.threads)
    print(f"模型就绪 {time.time()-t0:.0f}s\n")

    out_jl = open(os.path.join(rec_dir, "transcript_hq.jsonl"), "w", encoding="utf-8")
    out_md = open(os.path.join(rec_dir, "transcript_hq.md"), "w", encoding="utf-8")
    out_md.write(f"# 课堂记录（高精度重转写 · {args.model}）\n\n")

    last_speaker, changed = None, 0
    t0 = time.time()
    for i, ln in enumerate(lines, 1):
        a = int(ln["start"] * sr)
        b = min(len(audio), int(ln["end"] * sr))
        clip = audio[a:b]
        if clip.size < sr * 0.2:
            continue
        segs, _ = model.transcribe(
            clip, language=cfg["asr"]["language"], beam_size=2,
            condition_on_previous_text=False, vad_filter=False,
            initial_prompt=cfg["asr"]["prompt"])
        text = "".join(s.text for s in segs).strip()
        if not text:
            continue
        if text != ln["text"]:
            changed += 1

        new = {**ln, "text": text, "text_live": ln["text"]}
        out_jl.write(json.dumps(new, ensure_ascii=False) + "\n")

        body = f"**{text}**" if ln.get("kind") == "key" else (
            f"*{text}*" if ln.get("kind") == "define" else text)
        if ln["new_para"] or ln["speaker"] != last_speaker:
            out_md.write(f"\n\n[{ts(ln['start'])} {ln['speaker']}] {body}")
        else:
            out_md.write(body)
        last_speaker = ln["speaker"]

        if i % 20 == 0:
            done = time.time() - t0
            eta = done / i * (len(lines) - i)
            print(f"  {i}/{len(lines)}  已用 {done/60:.1f} 分  预计还要 {eta/60:.1f} 分", flush=True)
        out_jl.flush()
        out_md.flush()

    out_jl.close()
    out_md.write("\n")
    out_md.close()
    print(f"\n完成。{changed}/{len(lines)} 句的文字有改动。")
    print(f"  {os.path.join(rec_dir, 'transcript_hq.md')}")


if __name__ == "__main__":
    main()
