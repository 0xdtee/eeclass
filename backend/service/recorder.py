# -*- coding: utf-8 -*-
"""课堂记录落盘。

每节课一个目录：records\2026-07-27_1405_高等数学\
    transcript.jsonl   逐句结构化记录（时间/说话人/文本/重点标记/置信度）
    transcript.md      人读的版本，重点句用 **粗体** 标出
    audio.wav          原始音频（16k 单声道，一小时约 110MB，可在配置里关）
    meta.json          设备、模型、说话人统计

jsonl 是给课后二次处理用的结构化输入；md 是给人随手翻的。
写入都是即时 flush —— 万一 Word 崩了或者电脑没电，已经讲过的内容不会丢。
"""
import json
import os
import time

import numpy as np
import soundfile as sf   # 注意：本机 torchaudio.save 有问题，一律用 soundfile


class Recorder:
    def __init__(self, root, title=None, save_wav=True, existing_dir=None):
        # existing_dir 非空 = 续录:接着这节课已有的 transcript/audio 往下写(不新建目录)
        append = bool(existing_dir)
        if append:
            self.dir = existing_dir
        else:
            stamp = time.strftime("%Y-%m-%d_%H%M")
            name = f"{stamp}_{title}" if title else stamp
            name = "".join(c for c in name if c not in '\\/:*?"<>|')
            self.dir = os.path.join(root, name)
        os.makedirs(self.dir, exist_ok=True)

        self.jsonl = open(os.path.join(self.dir, "transcript.jsonl"), "a", encoding="utf-8")
        self.md = open(os.path.join(self.dir, "transcript.md"), "a", encoding="utf-8")
        if append:
            self.md.write(f"\n\n---(续录 {time.strftime('%H:%M')})---\n")
        else:
            self.md.write(f"# 课堂记录 {time.strftime('%Y-%m-%d_%H%M')}{(' ' + title) if title else ''}\n\n")
        self.md.flush()

        self.save_wav = save_wav
        self.wav = None
        if save_wav:
            apath = os.path.join(self.dir, "audio.wav")
            if append and os.path.exists(apath):
                # 追加到已有 wav 末尾(r+ 打开后 seek 到结尾),失败就不录这次音频、保住旧音频
                try:
                    self.wav = sf.SoundFile(apath, mode="r+")
                    self.wav.seek(0, 2)
                except Exception:
                    self.wav = None
            else:
                self.wav = sf.SoundFile(apath, mode="w", samplerate=16000, channels=1, subtype="PCM_16")
        self.last_speaker = None
        self.n = 0

    @staticmethod
    def ts(sec):
        s = int(sec)
        return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"

    def write(self, rec):
        self.jsonl.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.jsonl.flush()

        text = rec["text"]
        if rec.get("kind") == "key":
            text = f"**{text}**"
        elif rec.get("kind") == "define":
            text = f"*{text}*"

        if rec["new_para"] or rec["speaker"] != self.last_speaker:
            self.md.write(f"\n\n[{self.ts(rec['start'])} {rec['speaker']}] {text}")
        else:
            self.md.write(text)
        self.md.flush()
        self.last_speaker = rec["speaker"]
        self.n += 1

    def write_audio(self, frames):
        if self.wav is not None and frames.size:
            self.wav.write(np.clip(frames, -1.0, 1.0))

    def finish(self, meta):
        try:
            with open(os.path.join(self.dir, "meta.json"), "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
            self.md.write("\n")
            self.md.close()
            self.jsonl.close()
            if self.wav is not None:
                self.wav.close()
        except Exception:
            pass
        return self.dir
