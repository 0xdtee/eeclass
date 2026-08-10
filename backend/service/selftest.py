# -*- coding: utf-8 -*-
"""Offline self-test: take an audio file as the \"microphone input\" and run the whole pipeline once.

Verifies that VAD segmentation, speaker clustering, recognition, key-point marking, and paragraph logic all work,
without needing a mic or Word. Run this first after installation to save a lot of troubleshooting time.

Usage:
    python selftest.py <audio-file> [--seconds 120]
"""
import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vad import Segmenter, FRAME
from speaker import SpeakerID
from highlight import Highlighter
from asr import ASRWorker

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--seconds", type=float, default=120)
    ap.add_argument("--model", default=None)
    ap.add_argument("--backend", default=None,
                    help="whisper | sensevoice | funasr | zipformer（默认用 config.json 里的）")
    args = ap.parse_args()

    with open(os.path.join(HERE, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    if args.model:
        cfg["asr"]["model"] = args.model
    if args.backend:
        cfg["asr"]["backend"] = args.backend

    print("=" * 60)
    print("1) 解码音频")
    from faster_whisper.audio import decode_audio
    audio = decode_audio(args.audio, sampling_rate=16000)
    audio = audio[:int(args.seconds * 16000)]
    print(f"   {len(audio)/16000:.0f} 秒")

    print("2) 初始化组件")
    seg = Segmenter(cfg)
    print("   VAD OK")
    spk = SpeakerID(cfg)
    print(f"   说话人 {'OK' if spk.enabled else '停用: ' + str(spk.err)}")
    hl = Highlighter(cfg)
    print("   划重点 OK")

    results = []
    state = {"chars": 0, "start": None, "sid": None}

    def on_text(utt, meta, text, proc_s, translation=""):
        kind, score, reasons = hl.judge(text, utt.start)
        p = cfg["paragraph"]
        sid = meta["speaker_id"]
        too_long = (state["chars"] >= p["max_para_chars"]
                    or (state["start"] is not None
                        and utt.end - state["start"] >= p["max_para_seconds"]))
        new_para = (state["sid"] is None
                    or utt.gap_before >= p["new_para_gap_ms"] / 1000.0
                    or (p["break_on_speaker_change"] and sid != state["sid"])
                    or too_long)
        if new_para:
            state["chars"], state["start"] = len(text), utt.start
        else:
            state["chars"] += len(text)
        state["sid"] = sid

        results.append({
            "start": utt.start, "gap": utt.gap_before, "text": text,
            "sid": sid, "conf": meta["speaker_conf"], "forced": utt.forced,
            "kind": kind, "score": score, "reasons": reasons,
            "new_para": new_para, "proc_s": proc_s,
        })

    asr = ASRWorker(cfg, on_text)
    bk = cfg["asr"].get("backend", "whisper")
    print(f"3) 加载识别后端 {bk}" + (f" ({cfg['asr']['model']})" if bk == "whisper" else "") + " …")
    t0 = time.time()
    asr.load()
    print(f"   {time.time()-t0:.1f}s")
    asr.start()

    print("4) 逐帧喂入（模拟实时采集）")
    t0 = time.time()
    n_utt = 0
    for i in range(0, len(audio) - FRAME, FRAME):
        u = seg.push(audio[i:i + FRAME])
        if u is not None:
            n_utt += 1
            sid, conf = spk.identify(u.audio)
            asr.submit(u, {"speaker_id": sid, "speaker_conf": round(conf, 3)})
    tail = seg.flush()
    if tail is not None:
        n_utt += 1
        sid, conf = spk.identify(tail.audio)
        asr.submit(tail, {"speaker_id": sid, "speaker_conf": round(conf, 3)})
    print(f"   VAD 切出 {n_utt} 句，用时 {time.time()-t0:.1f}s")

    print("5) 等识别队列清空")
    while asr.backlog > 0 or asr.busy:
        time.sleep(0.2)
    time.sleep(0.5)
    asr.stop()

    print("=" * 60)
    print(f"后端 {asr.backend_name}   识别出 {len(results)} 句   RTF={asr.rtf:.2f}   "
          f"（<0.6 才能实时；本次没有真实时压力，仅供参考）")
    print(f"说话人 {len(spk.stats())} 个: " +
          ", ".join(f"#{s['id']} {s['seconds']}s/{s['utterances']}句" for s in spk.stats()))
    print("-" * 60)

    for r in results:
        mark = {"key": "【重点】", "define": "【定义】"}.get(r["kind"], "")
        newp = "\n¶ " if r["new_para"] else "  "
        cut = "" if not r["forced"] else "·软切"
        why = ("  ← " + " ".join(r["reasons"])) if r["reasons"] else ""
        print(f"{newp}[{int(r['start'])//60:02d}:{int(r['start'])%60:02d} "
              f"说话人{r['sid']} {r['conf']:.2f}{cut}] {mark}{r['text']}{why}")

    print("\n" + "-" * 60)
    keys = [r for r in results if r["kind"]]
    print(f"自动划出重点 {len(keys)} 句 / 共 {len(results)} 句")
    print(f"分成 {sum(1 for r in results if r['new_para'])} 段"
          f"（软切 {sum(1 for r in results if r['forced'])} 句）")
    gaps = [r["gap"] for r in results if r["gap"] > 0]
    if gaps:
        print(f"停顿: 中位 {np.median(gaps):.2f}s  最大 {max(gaps):.2f}s  "
              f"换段阈值 {cfg['paragraph']['new_para_gap_ms']/1000}s")
    lat = [r["proc_s"] for r in results]
    if lat:
        print(f"单句识别耗时: 中位 {np.median(lat):.1f}s  最差 {max(lat):.1f}s")

    if asr.retries:
        print(f"靠无提示词重试救回 {asr.retries} 句")
    if asr.drops:
        lost = sum(d["dur"] for d in asr.drops)
        print(f"\n被丢弃 {len(asr.drops)} 句，合计 {lost:.1f} 秒：")
        for d in asr.drops:
            print(f"  {int(d['start'])//60:02d}:{int(d['start'])%60:02d} "
                  f"({d['dur']:.1f}s) {d['reason']}"
                  + (f"   原始输出「{d['raw']}」" if d["raw"] else ""))
    print("自检结束。")


if __name__ == "__main__":
    main()
