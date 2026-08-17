# -*- coding: utf-8 -*-
"""Opt-in overlapping-speech worker (near-real-time).

When a session enables `separate_multi`, each VAD segment is routed here instead of straight to the
ASR worker. This worker does the I/O -- call the GPU separation service (2 streams) and recognize each
stream -- then hands the (audio, text) pairs back to the session, which owns all the speaker-identity
logic (so voiceprints are only touched from this one worker thread in separate mode). The session
emits one line (single speaker) or two attributed lines (real overlap, forced to two distinct speakers).

Fail-open: if the separation service is unreachable or errors, we recognize the original mixed segment
as a single line -- enabling this never *loses* content, it only *adds* the ability to split overlaps.

Config comes from env: SEP_HOST / SEP_PORT / SEP_TOKEN (kept out of config.json / git)."""
import os
import queue
import threading
import time

from separator_client import separate


class SepWorker:
    def __init__(self, cfg, backend, session, on_status=None):
        self.cfg = cfg
        self.backend = backend          # the loaded ASR backend (idle in separate mode -- only this worker uses it)
        self.session = session          # owns speaker id / naming / emit (called from this thread only)
        self.on_status = on_status
        self.host = os.environ.get("SEP_HOST", "").strip()
        self.port = int(os.environ.get("SEP_PORT", "18800") or 18800)
        self.token = os.environ.get("SEP_TOKEN", "").strip()
        self.timeout = float(os.environ.get("SEP_TIMEOUT", "20") or 20)
        self.q = queue.Queue()
        self.thread = None
        self.running = False
        self.busy = False

    @property
    def ready(self):
        return bool(self.host and self.token)

    @property
    def backlog(self):
        return self.q.qsize()

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True, name="sepworker")
        self.thread.start()

    def stop(self):
        self.running = False
        self.q.put(None)

    def submit(self, utt, meta):
        self.q.put(utt)

    def _tx(self, audio):
        try:
            return (self.backend.transcribe(audio, with_prompt=False) or "").strip()
        except TypeError:
            return (self.backend.transcribe(audio) or "").strip()

    def _loop(self):
        while self.running:
            item = self.q.get()
            if item is None:
                break
            utt = item
            self.busy = True
            t0 = time.time()
            try:
                streams = separate(utt.audio, self.host, self.port, self.token, self.timeout)
                if not streams:
                    pairs = [(utt.audio, self._tx(utt.audio))]           # fail-open: mixed segment as one line
                else:
                    s1, s2 = streams
                    pairs = [(s1, self._tx(s1)), (s2, self._tx(s2))]
                self.session._emit_separated(utt, pairs, t0)
            except Exception as e:
                if self.on_status:
                    self.on_status(f"分离处理异常: {type(e).__name__}")
            self.busy = False
