/* 课堂实时字幕 —— 浏览器控制台
 *
 * 和 taskpane.js 的区别：这一端**不写 Word**，只负责操作和显示。
 * 写文档由本地服务通过 COM 完成（service\word_com.py），因为这台机器上
 * Word 的 Web 加载项子系统是死的，任务窗格那条路点不出按钮。
 *
 * 好处顺带也拿到了：这个页面关掉、浏览器崩了，录音转写和写文档都照常继续。
 */

const MAX_LIVE = 200;     // 页面里最多留多少条字幕

let ws = null;
let running = false;

const $ = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", () => {
  bindUI();
  connect();
});

// 本机实测数据（90 秒课堂录音，同一套 VAD 切句）。选引擎时直接看到代价。
const BK_HINT = {
  sensevoice: "RTF 0.05，最差单句 0.4 秒，自带标点。中文错字最少，默认就用它。",
  "zipformer-stream": "真流式：说到一半就出字（首字约 0.6 秒），但中途文本会边说边改、且没有标点；断句定稿时才补标点并写进 Word。",
  zipformer: "RTF 0.17，最差 1.6 秒。模型不带标点，由标点模型补。一般没理由选它，除非要中英混说。",
  funasr: "和 SenseVoice 同一个模型，走 FunASR 官方运行时：慢一倍（RTF 0.10）、启动多花 20 秒。需要 FunASR 生态其它能力时才用。",
  whisper: "RTF 0.44，最差单句 3.1 秒——比 SenseVoice 慢 10 倍，中文错字也更多。留着做对照。",
};

// 拾音灵敏度。数字是本机用真实课堂录音扫出来的，别随手改。
// 0.20 以下会开始把噪声认成人话（实测冒出「一颗佛的城堡」这种）。
const SENS = {
  std:  { threshold: 0.50, exit_threshold: 0.35, min_speech_ms: 250 },
  high: { threshold: 0.35, exit_threshold: 0.22, min_speech_ms: 180 },
  max:  { threshold: 0.30, exit_threshold: 0.20, min_speech_ms: 150 },
};
const SENS_HINT = {
  std:  "只收清楚的说话声。老师声音小或你坐得远时会整段漏掉——实测漏过 40% 的字。",
  high: "推荐。实测比「标准」多捞回 20~40% 的内容，捞回来的都是真话不是噪声。",
  max:  "教室大、离得远时用。会多收一些环境声，偶尔冒出一两句莫名其妙的话。",
};

function bindUI() {
  $("gap").addEventListener("input", (e) => { $("gapval").textContent = (+e.target.value).toFixed(1); });
  $("backend").addEventListener("change", onBackend);
  $("sens").addEventListener("change", onSens);
  onBackend();
  onSens();
  $("start").addEventListener("click", start);
  $("stop").addEventListener("click", () => send({ cmd: "stop" }));
  $("mark").addEventListener("click", () => send({ cmd: "mark" }));
  $("pause").addEventListener("click", (e) => {
    const on = !e.target.classList.contains("active");
    e.target.classList.toggle("active", on);
    e.target.textContent = on ? "继续" : "暂停";
    send({ cmd: "pause", value: on });
  });
}

function onBackend() {
  const v = $("backend").value;
  $("bkhint").textContent = BK_HINT[v] || "";
  $("modelrow").hidden = v !== "whisper";
}

function onSens() {
  $("senshint").textContent = SENS_HINT[$("sens").value] || "";
}

function start() {
  const dev = $("device").value;
  const opt = $("device").selectedOptions[0];
  const bk = $("backend").value;
  send({
    cmd: "start",
    title: $("title").value.trim() || null,
    device: dev === "" ? null : dev,          // "sd:9"（麦克风）或 "sc:0"（系统声音）
    loopback: opt && opt.dataset.kind === "loopback",
    backend: bk === "zipformer-stream" ? "zipformer" : bk,
    streaming: bk === "zipformer-stream",
    model: $("model").value,
    new_para_gap_ms: Math.round(parseFloat($("gap").value) * 1000),
    vad: SENS[$("sens").value],
    to_word: $("toWord").checked,
    word_doc: $("worddoc").value,
    only_key: $("onlyKey").checked,
  });
  $("start").disabled = true;
  $("start").textContent = "正在启动…";
}

/* ============ 与本地服务通信 ============ */
function connect() {
  try {
    ws = new WebSocket(`wss://${location.host}/ws`);
  } catch (e) {
    return setTimeout(connect, 2000);
  }
  ws.onopen = () => setConn(true, "已连接本地服务");
  ws.onclose = () => { setConn(false, "服务未运行 —— 请先运行 start.ps1"); setTimeout(connect, 2000); };
  ws.onerror = () => setConn(false, "连接失败，请确认 start.ps1 已启动");
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (_) {} };
}

function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function setConn(ok, text) {
  $("dot").className = "dot " + (running ? "rec" : ok ? "on" : "off");
  $("conn").textContent = running ? "正在听课…" : text;
}

function onMsg(m) {
  switch (m.type) {
    case "hello":
      fillDevices(m.devices, m.default_device);
      if (m.config) {
        $("model").value = m.config.asr.model;
        const bk = m.config.asr.backend || "whisper";
        $("backend").value = (bk === "zipformer" && m.config.asr.streaming)
          ? "zipformer-stream" : bk;
        onBackend();
        const th = m.config.vad && m.config.vad.threshold;
        if (th !== undefined) {
          $("sens").value = th >= 0.45 ? "std" : th <= 0.32 ? "max" : "high";
          onSens();
        }
        const g = m.config.paragraph.new_para_gap_ms / 1000;
        $("gap").value = g; $("gapval").textContent = g.toFixed(1);
      }
      break;

    case "devices": fillDevices(m.devices, null); break;

    case "started":
      running = true;
      $("start").hidden = true; $("start").disabled = false; $("start").textContent = "开始听课";
      $("stop").hidden = false; $("subbtns").hidden = false;
      $("setup").hidden = true; $("statbar").hidden = false; $("speakers").hidden = false;
      setConn(true, "");
      note(`已开麦：${m.name}${m.loopback ? "（系统声音）" : ""}，模型加载用了 ${m.model_load_s}s`);
      if (m.speaker_error) note(m.speaker_error, true);
      $("recdir").textContent = "记录保存在：" + m.dir;
      showWord(m.word);
      break;

    case "stopped":
      running = false;
      $("start").hidden = false; $("stop").hidden = true; $("subbtns").hidden = true;
      $("setup").hidden = false;
      setConn(true, "已停止");
      note(`已保存 ${m.meta.lines} 句到 ${m.dir}`);
      break;

    case "line": onLine(m); break;
    case "partial": onPartial(m.text); break;
    case "status": onStatus(m); break;
    case "renamed": note(`已把文档里的「${m.old}」改成「${m.name}」`); break;
    case "notice": note(m.msg); break;
    case "error": note(m.msg, true); break;
  }
}

function fillDevices(devs, def) {
  const sel = $("device");
  sel.innerHTML = "";
  for (const d of devs) {
    const o = document.createElement("option");
    o.value = d.id;
    o.dataset.kind = d.kind;
    // shaky = 只有 WDM-KS 这一条驱动通道，实测经常开不起来（-9999 / -9996）。
    // 不隐藏（有的设备只剩这一条路），但要让人一眼看出风险。
    o.textContent = (d.shaky ? "⚠ " : "") +
      (d.kind === "loopback" ? "🔊 系统声音 · " : "🎤 ") + d.name +
      (d.shaky ? "（这条通道可能开不起来）" : "");
    if (d.id === def) o.selected = true;
    sel.appendChild(o);
  }
}

function showWord(w) {
  const el = $("wordstat");
  if (!w) { el.textContent = "本次没有写入 Word（只存记录文件）。"; el.className = "hint"; return; }
  if (w.ok) {
    el.textContent = `正在写入 Word：${w.doc}` + (w.written ? `（已写 ${w.written} 句）` : "");
    el.className = "hint";
  } else {
    el.textContent = w.error || "写入 Word 失败";
    el.className = "hint err";
  }
}

function onStatus(s) {
  $("level").style.width = Math.min(100, s.level * 180) + "%";
  $("stat-time").textContent = fmtTime(s.elapsed);
  $("stat-lines").textContent = s.lines + " 句";
  const lag = $("stat-lag");
  lag.textContent = "积压 " + s.backlog;
  lag.className = s.backlog > 3 ? "warn" : "";
  const rtf = $("stat-rtf");
  rtf.textContent = "RTF " + (s.rtf || "-");
  rtf.className = s.rtf > 1 ? "warn" : "";
  if (s.speakers) drawSpeakers(s.speakers);
  if (s.word !== undefined) showWord(s.word);
}

function drawSpeakers(list) {
  const box = $("spklist");
  const sig = list.map((s) => s.id + s.name + s.seconds).join("|");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = "";
  for (const s of list) {
    const row = document.createElement("div");
    row.className = "spk";
    const inp = document.createElement("input");
    inp.value = s.name;
    inp.addEventListener("change", () => {
      const nv = inp.value.trim();
      if (nv && nv !== s.name) send({ cmd: "rename", id: s.id, name: nv });
    });
    const sec = document.createElement("span");
    sec.className = "sec";
    sec.textContent = fmtTime(s.seconds);
    row.append(inp, sec);
    box.appendChild(row);
  }
}

/* 流式后端的中途结果。只显示，不写文档——它随时会被改写。 */
function onPartial(text) {
  const box = $("lines");
  let el = document.getElementById("partial");
  if (!text) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "partial";
    el.className = "ln partial";
    box.appendChild(el);
  }
  el.textContent = text + " …";
  box.scrollTop = box.scrollHeight;
}

function onLine(m) {
  const box = $("lines");
  const p = document.getElementById("partial");
  if (p) p.remove();          // 这句定稿了，把中途那行换掉
  const div = document.createElement("div");
  div.className = "ln" + (m.kind ? " " + m.kind : "");
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `${m.ts} ${m.speaker}`;
  div.appendChild(meta);
  div.appendChild(document.createTextNode(m.text));
  if (m.reasons && m.reasons.length) {
    const why = document.createElement("span");
    why.className = "why";
    why.textContent = "· " + m.reasons.join(" ");
    div.appendChild(why);
  }
  box.appendChild(div);
  while (box.children.length > MAX_LIVE) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

/* ============ 杂项 ============ */
function fmtTime(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? String(h).padStart(2, "0") + ":" : "") +
         String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

let noticeTimer = null;
function note(msg, isErr) {
  const n = $("notice");
  n.textContent = msg;
  n.className = isErr ? "err" : "";
  clearTimeout(noticeTimer);
  if (!isErr) noticeTimer = setTimeout(() => { n.textContent = ""; }, 8000);
}
