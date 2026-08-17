# -*- coding: utf-8 -*-
"""Client for the GPU speech-separation microservice (runs on a Jetson, see sep_service.py).

POST raw int16 16k mono PCM -> body: [4B little-endian len1][stream1 int16][stream2 int16].
Kept dependency-free (http.client + numpy) so it drops into the backend venv unchanged."""
import http.client
import numpy as np

def separate(audio_f32, host, port, token, timeout=20.0):
    """Send one 16k mono float32 segment; return (s1, s2) float32 arrays, or None on any failure.
    Never raises -- the caller falls back to single-stream recognition when this returns None."""
    if not host or not token:
        return None
    pcm = (np.clip(audio_f32, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    conn = None
    try:
        conn = http.client.HTTPConnection(host, port, timeout=timeout)
        conn.request("POST", "/separate", body=pcm,
                     headers={"Content-Type": "application/octet-stream",
                              "Content-Length": str(len(pcm)),
                              "X-Token": token})
        resp = conn.getresponse()
        if resp.status != 200:
            resp.read()
            return None
        body = resp.read()
        if len(body) < 4:
            return None
        n1 = int.from_bytes(body[:4], "little")
        b1 = body[4:4 + n1]
        b2 = body[4 + n1:]
        s1 = np.frombuffer(b1, dtype="<i2").astype(np.float32) / 32768.0
        s2 = np.frombuffer(b2, dtype="<i2").astype(np.float32) / 32768.0
        if s1.size == 0 or s2.size == 0:
            return None
        return s1, s2
    except Exception:
        return None
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass
