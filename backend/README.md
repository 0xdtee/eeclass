# Real-Time Classroom Captions (Word Add-in)

Click once when class starts, and it automatically turns on the mic and writes what the teacher says into a Word document in real time — separating speakers, breaking into paragraphs on pauses, and automatically highlighting key points. It all runs locally: no internet, no uploads, no cost.

---

## What it looks like

A **console** page pops up in your browser: enter the course name, pick a microphone, and click "Start Listening." Then, in the Word document you have open, text starts appearing:

```
高等数学 第12讲 · 2026/7/27 14:05          ← Title (Heading 2)

[00:12:35 老师] 这个地方我们要注意，格林公式的条件是闭合正向边界。曲线必须是分段光滑的。

[00:12:48 老师] 这个必考，期末大题一定有一道。                ← Whole sentence highlighted yellow

[00:13:02 同学A] 老师那如果曲线不闭合呢?                      ← New speaker starts a new paragraph
```

- **Yellow highlight** = key point (the teacher explicitly says "will be on the exam / important / write this down," or repeats it twice for emphasis)
- **Light green highlight** = definition ("… is called / is termed / is defined as / is denoted")
- A new paragraph starts only after a pause longer than 1.5 seconds; short pauses continue the same paragraph — it reads like notes, not like line-by-line subtitles

---

## Installation (one time only)

```powershell
cd C:\workspace\word-live-caption\scripts
.\install.ps1
```

Partway through, a Windows certificate trust dialog pops up once (to install a local development certificate for `https://localhost`) — click "Yes."

## Every class

Double-click **课堂字幕** on the desktop (or run `.\scripts\start.ps1`) — **don't close that black window; closing it stops everything.**

The console opens automatically in your browser. **First open the Word document you want to take notes in**, then click "Start Listening" in the console — the captions will be written into that document. (It's fine if you don't have Word open; it will create a new document automatically.)

> The browser console is the **official operating interface**, not a temporary stand-in. Even if the Word add-in becomes usable someday, the console stays; running both interfaces at once won't write captions twice — when the sidebar detects that the server is writing via COM, it automatically yields write access and only displays.

---

## Why this architecture

Originally it was built as a Word add-in (a button on the ribbon plus a sidebar). **It could never be made to work on this machine**: the registry, the manifest (which passed the official validator), the HTTPS certificate, and group policy were all correct, but Word's web add-in subsystem simply wouldn't budge — it didn't scan the registry entries, didn't rebuild the Wef cache, and didn't write a single byte to the runtime log. This wasn't a code problem, so we switched to **COM automation**: the service operates Word directly to write the document, with no add-in needed at all.

**In practice, the web console turned out to be more convenient anyway** (it doesn't take up Word's screen real estate, it can sit on a separate monitor, and it's still there when Word crashes), so it's the long-term solution, not a stopgap. The add-in code (`manifest.xml` / `taskpane.*`) is kept around too; if it ever starts working again, it's just one more entry point — the two coexist without conflict.

Recording and recognition were always entirely inside the local Python service; the control interface communicates over `wss://localhost:5901`:

```
Mic / system audio ──▶ capture (16k mono)
                      │
                 silero VAD segmentation
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   CAM++ voiceprint  faster-whisper  keyword rules
   (speaker)          (speech→text)   (highlighting)
        └─────────────┼─────────────┘
                      ▼
              ┌───────┴────────┐
        COM ──▶ Word document   WebSocket ──▶ browser console (view & control only)
              └───▶ records\ on disk
```

**Benefits**: the microphone permission problem is completely sidestepped; it can also capture system audio on the side (online classes / Tencent Meeting); and **even if Word is closed, the console page is closed, or the browser crashes, recording and transcription keep going** — a whole class won't be wasted (when it can't write to Word, the console shows a notice, but the record files are saved to disk as usual).

---

## Recognition backend (selectable in the console; `asr.backend` in config.json)

Same 90-second classroom recording, same VAD sentence splitting, measured on this machine (i7-1255U, pure CPU, 6 threads):

| Backend | RTF | Worst single sentence | Punctuation | Notes |
|---|---|---|---|---|
| **sensevoice** | **0.05** | **0.4s** | Built-in | **Default**. Alibaba SenseVoice-Small, via sherpa-onnx |
| funasr | 0.10 | 0.9s | Built-in | Same model, via the official FunASR runtime. Twice as slow; the import alone takes 19 seconds |
| zipformer | 0.17 | 1.6s | Added on | A streaming model used for whole sentences. Usually no reason to pick it |
| **zipformer (streaming)** | 0.09 | — | Added at sentence break | **Text appears as you speak, first character in 0.6 seconds** |
| whisper small | 0.44 | 3.1s | Built-in | The original approach, kept for comparison |

SenseVoice is also more accurate; in the same passage it gets right what whisper got wrong: 「利润的过程」→ **议论**, 「阿因斯坦」→ **爱因斯坦**, 「一些问题」→ **一系列问题**.

**Which one to pick**

- For everyday use, stick with the default **sensevoice**. It's 10x faster than the old whisper and makes fewer errors, cutting end-to-end latency from 3–11 seconds to **2–8 seconds** (the bulk now being "waiting for the sentence to finish," no longer compute).
- If you want "text appearing while the teacher is mid-sentence," pick **streaming Zipformer**. The trade-off: the interim text keeps changing as you speak, and it has no punctuation — punctuation is added only once the sentence is finalized and written to Word; it handles mixed Chinese-English better than SenseVoice.
- Pick **funasr** only when you need other capabilities from the FunASR ecosystem (emotion/event tags, etc.); otherwise it's a pure loss.

> This CPU has 2 performance cores + 8 efficiency cores; giving it 10 threads causes them to trip over each other on the small cores — **6 is the sweet spot**. Don't run something CPU-hungry like Minecraft during class — in the whisper era, RTF was measured to jump from 0.37 to 7.11. After switching to SenseVoice there's much more headroom, but still don't run heavy workloads during class.

Historical data (whisper-era model selection, explaining why `small` was chosen at the time):

| Model | Threads | RTF | Worst single sentence |
|---|---|---|---|
| small | 6 | 0.37 | 4.0s |
| small | 10 | 0.60 | 13.2s |
| large-v3-turbo | 6 | 1.86 | 20.1s |
| large-v3-turbo | 10 | 2.58 | 23.3s |

---

## The prompt pitfall (only affects the whisper backend)

The `asr.prompt` in `config.json` **must be written as a single example of an actual classroom sentence, complete with punctuation** — not as an instruction like "please use Simplified Chinese and add punctuation." Measured comparison (120-second audio, 19 sentences):

| Prompt | Dropped sentences | Traditional chars | Punctuation density | Total chars |
|---|---|---|---|---|
| Long instruction "please use Simplified Chinese with punctuation + glossary" | **5 sentences / 25s** | 0 | 0.083 | 396 |
| Short instruction "Simplified Chinese, add punctuation." | 2 | 0 | 0.077 | 389 |
| No prompt at all | 0 | **61** | **0** | 450 |
| **Example sentence + hotwords** | **0** | **0** | 0.077 | **453** |

The `small` model repeats the **instruction** verbatim in its output (outputting "please use Simplified Chinese and add punctuation."), and filtering that out means **the whole passage of class is lost**. With no prompt at all, the output is full of Traditional characters and zero punctuation. Give it one example sentence and it transcribes in that style — protecting both ends.

Put the glossary in `hotwords` (in `get_prompt`, hotwords and initial_prompt share the same `sot_prev` context, so they can coexist); this way terms get corrected without leaking into the body text.

There's one more safeguard: any sentence judged empty/a repeat is **automatically retried once with the prompt removed**; only if both attempts fail is it dropped, and it's logged in the `drops` statistics. Better to spend an extra couple of seconds than to silently miss content.

---

## Quiet speech getting dropped? — Checked it: the problem is the VAD threshold, not the volume

Tested item by item using two real recordings (189 seconds + 109 seconds, recorded live with this machine's microphone):

| Approach tried | Result |
|---|---|
| Turned the whole audio down to -36dB | **No dropped words** (390→386 chars) — volume alone isn't the problem |
| Added real ambient noise, down to 0dB SNR | **No dropped words** — both VAD and SenseVoice are very noise-resistant |
| Automatic gain control (AGC) on the capture side | **Worse**: 54 sentences/541 chars → 43 sentences/503 chars. It changed the signal the VAD sees |
| Normalize each sentence before recognition | Same as leaving it alone (544 vs 541 chars) — SenseVoice is insensitive to level |
| **Changed the VAD threshold from 0.50 to 0.35** | **Effective**: the 189s clip went 250→268 chars, the 109s clip went 112→**157** chars (+40%) |

**Conclusion: quiet speech isn't "recognized wrong" — the VAD simply never cut it out to send for recognition.** The threshold is now set to 0.35, and the console's "Pickup Sensitivity" can be adjusted on the fly. Don't go below 0.20 — testing showed it starts recognizing noise as sentences like 「一颗佛的城堡」.

The AGC class in `audio.py` is kept but disabled by default, and the measured numbers are noted in the config comments so we don't go down this dead end again.

## Speaker recognition

The **ERes2NetV2** Chinese voiceprint model (68MB ONNX) + online clustering + automatic merging. Each sentence extracts one voiceprint vector, compares cosine similarity against the centroids of known speakers, and if it exceeds **0.35** it's grouped in and the centroid is updated; otherwise a new person is created.

- The first person to speak is labeled "老师" (Teacher) by default; the rest are "同学A/B/C" (Student A/B/C) in order
- The console lets you rename them, and **once renamed, names already written in the document are replaced automatically**
- Voiceprints for sentences shorter than 1 second aren't reliable, so the previous sentence's speaker is reused
- **Automatic merging**: after each sentence, the centroids are checked, and if two "people" are similar to above 0.55 they're judged to be the same person — the later-created one is merged into the earlier one, and names already written in the document are updated too. **Merging only, never splitting** is intentional — a wrong merge at worst blends two people into one, whereas a wrong split would sprout a bunch of nonexistent "students" in the document.

### How the parameters were determined (an annotated three-person conversation, 44 sentences measured)

| Model | Lowest same-person similarity | Different-person 95th percentile | Threshold range for 100% accuracy |
|---|---|---|---|
| campplus (previously used) | 0.178 | 0.254 | **Only a single point, 0.30** |
| **ERes2NetV2 (current)** | 0.319 | 0.256 | **A whole band, 0.20 ~ 0.40** |

The old campplus + threshold 0.60: **90.9% accurate, clustering 3 people into 7** — two sentences from the same person often had a similarity of just over 0.4, not reaching 0.60 and thus judged a new person; this is the origin of "one person split into Student A/B/C." Now ERes2NetV2 + 0.35: **100% accurate, exactly 3 people**.

The cost: voiceprint extraction takes 356ms per sentence (campplus was 66ms). Plus 350ms for recognition, a sentence totals about 0.7 seconds — still plenty of headroom for sentences of 5–8 seconds.

Tried but **ineffective**: normalizing the audio amplitude before extracting the voiceprint — no difference at all, don't try it again.

Tuning `speaker.threshold`: if people aren't being separated, lower it; if one person is being split into two, then… no need to tune — automatic merging catches it; if you really must tune, tune `merge_threshold` (default 0.55, lower = more eager to merge).

---

## Highlighting key points

Pure rules, zero latency, zero cost. Weighted scoring; highlight when the total score is ≥ 2:

| Signal | Example | Score |
|---|---|---|
| Strong verbal cue | 必考、期末、记一下、划重点、一定要 | +2 |
| Definition phrasing | 叫做、称为、定义为、记作 | +2 (marked green) |
| Medium verbal cue | 注意、关键、核心、也就是说 | +1 |
| Theorem / formula | 公式、定理、推论、判别法 | +1 |
| Math symbol density | Presence of ∫ ∑ ≤ partial derivatives, etc. | +1 |
| Repeated emphasis | Said something highly similar twice within 90 seconds | +1 |

The word lists live in `highlight` in `config.json`; add your own teacher's pet phrases as you go. The sidebar also has a "Mark next sentence as key point" button, so you can fill in manually when the rules miss.

**Post-class close reading**: each class's `transcript.jsonl` is a per-sentence structured record (time / speaker / text / key-point flag), well suited for a second pass after class with a script or a large model — it can see the whole class's context, making it more accurate than real-time rules.

---

## Where it's stored

```
records\2026-07-27_1405_Advanced-Math\
    transcript.jsonl     structured per-sentence record (use this for close reading after class)
    transcript.md        human-readable version, key sentences in **bold**
    audio.wav            raw audio, 16k mono, ~110MB per hour
    meta.json            device, model, per-speaker stats, RTF
```

Every write is flushed immediately; a power loss or crash loses only the last sentence.

## High-accuracy re-transcription after class

Using `small` during class is to keep up in real time, which means some typos. After class there's no real-time pressure, so re-run `audio.wav` through `large-v3-turbo`, reusing the class's speaker and paragraph results and swapping in just the text:

```powershell
C:\workspace\.venv-asr\Scripts\python.exe service\retranscribe.py
```

A one-hour class takes 1.5–2 hours to run (RTF 1.86), so it's best left running overnight. It produces `transcript_hq.md` and `transcript_hq.jsonl`, the latter retaining a `text_live` field for comparison.

---

## Tuning quick reference (`service\config.json`; no service restart needed after changes, they take effect at the next class)

| Problem to solve | What to change |
|---|---|
| Want to switch recognition engine | `asr.backend`, or just pick it in the console |
| Streaming-mode sentences too fragmented / too long | `asr.zipformer.rule2_min_trailing_silence` (default 1.2s of silence before breaking) |
| A speaker split into several in streaming mode | Increase `asr.zipformer.merge.below_seconds` (threshold for merging a fragment into the next sentence) |
| Paragraphs too long / too fragmented | `paragraph.new_para_gap_ms` (default 1500), or the sidebar slider |
| One paragraph writes too much without breaking | `paragraph.max_para_chars` 220 / `max_para_seconds` 45 |
| Captions appear too slowly | Lower `vad.max_utterance_ms` 8000 (sentences will be more fragmented) |
| Teacher's short pauses keep getting cut off | Increase `vad.min_silence_ms` 380 |
| Quiet speech not being recorded | Set the console's "Pickup Sensitivity" to "Most Sensitive," or lower `vad.threshold` |
| Coughs, page-turning taken as speech | Set "Pickup Sensitivity" back to "Standard," or raise `vad.threshold` and increase `min_speech_ms` |
| CPU can't keep up (backlog > 3) | Try `asr.cpu_threads` 4, or confirm nothing else is eating CPU |
| A term keeps being misrecognized | Add the word to `asr.hotwords` |
| Speakers not separated / being split | Adjust `speaker.threshold` around 0.60 |
| Don't want to save recordings (save space) | Set `server.save_wav` to false (then you can't re-transcribe after class) |

---

## Run the self-check first when something goes wrong

No mic, no Word — just take an audio file and run the whole pipeline through it:

```powershell
C:\workspace\.venv-asr\Scripts\python.exe service\selftest.py "some_recording.m4a" --seconds 120
# Compare backends:
C:\workspace\.venv-asr\Scripts\python.exe service\selftest.py "some_recording.m4a" --backend whisper
```

It prints: how many sentences the VAD cut, how many speaker clusters were formed, the recognition time per sentence, the RTF, how many paragraphs were made, how many key points were highlighted, **and the dropped sentences with the reason for each drop**. Dropped-word problems can be pinpointed from that last section.

## FAQ

**The console says "Word writing interrupted"**
Word or that document was closed. Just stop and start again once; nothing from the meantime is lost, and the `transcript.md` in `records\` is always complete.

**Captions were written into the wrong document**
It writes to the "current active document." Before starting to listen, click the Word window you want to take notes in, or set "Which Word document to write into" in the console to "Create a new one each time."

**How long does startup take**
About **2.8 seconds** from double-click to the service being ready, and the console page pops up right after; clicking "Start Listening" then waits 1.5 seconds to load the model (add 20 seconds for the funasr backend — its import alone takes that long). If it feels noticeably slower, it's most likely antivirus scanning the model files on first access, or another process on the machine eating CPU.

> Two things that used to slow down startup and have since been fixed: ① `vad.py` was doing `import faster_whisper` just to figure out a model file path — that one line alone took 3–7 seconds, and the default backend doesn't use it at all; now the 1.2MB silero model is copied to `service\models\` and used directly. ② `start.ps1` used `Invoke-WebRequest` to probe whether the service was ready, which has to go through the TLS handshake / certificate / system proxy and is unreliable; once the probe failed it would spin until timeout (20 seconds) before opening the browser. It's now changed to a bare TCP port probe.

**PortAudioError / can't open the audio source**
An audio source name prefixed with **⚠** has only the WDM-KS driver channel — this path frequently fails to open on Windows (measured on this machine: Bluetooth headset hands-free reports `-9999 WdmSyncIoctl`, the Realtek microphone array reports `-9996 Invalid device`). Pick one without the ⚠.

Even if you do pick one, it won't keep you from class: the service first tries the same microphone's channels under WASAPI/MME, and if none work, falls back to the default microphone, stating in the console which one it switched to.

**Reports `[Errno 10048] ... only one usage of each socket address is normally permitted`**
Port 5901 is already taken, most likely because **the service is already running** (the previous black window wasn't closed, or it's in the background). Double-clicking now won't hit this error again: `start.ps1` first probes the port, and if it recognizes it as its own service, just opens the console. To fully restart, first run `Get-Process python | Stop-Process -Force`, or use `netstat -ano | findstr :5901` to see what's holding it.

**Console shows "Service not running"**
Check whether that `start.ps1` window was closed. Or visit `https://localhost:5901/health` in the browser to see.

**Certificate error / page won't open**
Re-run `npx office-addin-dev-certs install`.

**No internet in the classroom**
Doesn't matter. The console page is served by the local service, and the recognition model is also on this machine — no internet is needed at any point.

**Captions can't keep up (backlog persistently > 3)**
Close CPU-hungry programs. If that doesn't help, set `cpu_threads` to 4, or accept higher latency.

---

## Code structure

```
service\
    server.py        main service: HTTPS + WebSocket + orchestration
    audio.py         WASAPI capture (mic / system-audio loopback)
    vad.py           streaming silero VAD, natural sentence cuts + soft cuts
    asr.py           recognition worker threads: queue, cleanup, hallucination filter, stats
    asr_backends.py  pluggable backends: whisper / sensevoice / funasr / zipformer
    stream_asr.py    streaming recognition (words appear as you speak), an alternative to VAD-based cutting
    speaker.py       CAM++ voiceprint + online clustering
    highlight.py     rule-based highlighting
    recorder.py      write jsonl / md / wav to disk
    word_com.py      write to Word via COM (the path currently in use)
    retranscribe.py  high-accuracy re-transcription after class
    selftest.py      offline self-check
    gen_icons.py     generate ribbon icons
addin\
    panel.html/js    browser console (the interface currently in use)
    taskpane.css     styles shared by both
    manifest.xml     Word add-in manifest    ┐ the add-in path doesn't work for now;
    taskpane.html/js Word task pane           ┘ code kept to switch back to later
scripts\
    install.ps1  start.ps1
```
