# -*- coding: utf-8 -*-
"""Persist classroom records to disk.

One directory per class session: records\2026-07-27_1405_Advanced-Math\
    transcript.jsonl   per-utterance structured record (time/speaker/text/key-point flag/confidence)
    transcript.md      human-readable version, key sentences marked in **bold**
    audio.wav          raw audio (16k mono, ~110MB per hour, can be disabled in config)
    meta.json          device, model, and speaker stats

jsonl is the structured input for post-class processing; md is for people to skim.
Every write is flushed immediately -- if Word crashes or the machine loses power, nothing already spoken is lost.
"""
import json
import os
import secrets
import time

import numpy as np
import soundfile as sf   # Note: torchaudio.save is broken on this machine, always use soundfile


class Recorder:
    def __init__(self, root, title=None, save_wav=True, existing_dir=None):
        # existing_dir non-empty = resume: append to this session's existing transcript/audio (no new dir)
        append = bool(existing_dir)
        if append:
            self.dir = existing_dir
            os.makedirs(self.dir, exist_ok=True)
        else:
            stamp = time.strftime("%Y-%m-%d_%H%M")
            name = f"{stamp}_{title}" if title else stamp
            name = "".join(c for c in name if c not in '\\/:*?"<>|')
            # Create a UNIQUE directory atomically. Two accounts recording the same class in the
            # same minute would otherwise use the default title "课程 MM-DD HH:MM" and collide on
            # one folder -- clobbering each other's audio.wav/transcript/owner. exist_ok=False makes
            # the create atomic; on collision we retry with a short random suffix. Single-user
            # recordings keep the clean name (meta.title drives the display, so the suffix is invisible).
            base = os.path.join(root, name)
            d = base
            while True:
                try:
                    os.makedirs(d, exist_ok=False)
                    break
                except FileExistsError:
                    d = f"{base}_{secrets.token_hex(3)}"
            self.dir = d

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
                # Append to the end of the existing wav (open r+ then seek to end); on failure skip this recording and keep the old audio
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
