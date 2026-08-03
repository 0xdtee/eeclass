# -*- coding: utf-8 -*-
"""系统压测:各 ASR 后端的模型加载时间、单路实时率(RTF)、以及并发扩展性
(N 路同时转写时的最坏 RTF,用来估单机能撑几路实时)。纯 CPU。

RTF = 解码耗时 / 音频时长;<1 才能实时。并发时看最慢那一路的 RTF。

用法: ../.venv/bin/python research/bench_rtf.py
"""
import json, os, sys, time, threading
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "service"))
from asr_backends import make_backend

HERE = os.path.dirname(os.path.abspath(__file__))
WAV = os.path.join(HERE, "..", "records", "2026-07-30_1845_数学", "audio.wav")
DUR_S = 60
BACKENDS = ["sensevoice", "paraformer", "zipformer"]
CONC = [1, 2, 4, 6]


def load_audio():
    a, sr = sf.read(WAV, dtype="float32")
    if a.ndim > 1:
        a = a[:, 0]
    return a[: 16000 * DUR_S]


def bench_backend(name, audio):
    cfg = json.load(open(os.path.join(HERE, "..", "service", "config.json"), encoding="utf-8"))
    cfg["asr"]["backend"] = name
    b = make_backend(cfg)
    load_s = b.load()
    b.transcribe(audio)                       # 预热
    # 单路 RTF(取 3 次中位)
    ts = []
    for _ in range(3):
        t0 = time.time(); b.transcribe(audio); ts.append(time.time() - t0)
    ts.sort()
    rtf1 = ts[1] / DUR_S
    # 并发:N 路同时解码,记最慢一路的耗时
    conc = {}
    for n in CONC:
        times = [0.0] * n
        def work(i):
            t0 = time.time(); b.transcribe(audio); times[i] = time.time() - t0
        thrs = [threading.Thread(target=work, args=(i,)) for i in range(n)]
        t0 = time.time()
        for t in thrs: t.start()
        for t in thrs: t.join()
        conc[n] = max(times) / DUR_S          # 最坏 RTF@N
    return load_s, rtf1, conc


def main():
    audio = load_audio()
    ncpu = os.cpu_count()
    print(f"机器 CPU 逻辑核: {ncpu}  | 测试音频: {DUR_S}s  | cpu_threads(配置): "
          f"{json.load(open(os.path.join(HERE,'..','service','config.json'),encoding='utf-8'))['asr'].get('cpu_threads')}\n")
    hdr = ["后端", "加载s", "RTF@1"] + [f"RTF@{n}" for n in CONC] + ["≈可撑实时路数"]
    print(("{:<12}" + "{:>8}" * (2 + len(CONC)) + "{:>14}").format(*hdr))
    for name in BACKENDS:
        try:
            load_s, rtf1, conc = bench_backend(name, audio)
        except Exception as e:
            print(f"{name:<12} 失败: {e}")
            continue
        # 可撑实时路数 ≈ 最大的 N 使 RTF@N < 1
        cap = max([n for n in CONC if conc[n] < 1.0], default=0)
        cap_s = f"≥{cap}" if cap == max(CONC) else str(cap)
        row = [name, f"{load_s:.2f}", f"{rtf1:.3f}"] + [f"{conc[n]:.3f}" for n in CONC] + [cap_s]
        print(("{:<12}" + "{:>8}" * (2 + len(CONC)) + "{:>14}").format(*row))
    print("\n注:RTF<1 才实时;RTF@N 是 N 路并发时最慢一路的实时率。")


if __name__ == "__main__":
    main()
