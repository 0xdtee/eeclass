/* Live classroom captions — Word task pane
 *
 * This side does only two things: show status and write recognition results into the document.
 * Recording, recognition, speaker ID, and highlighting all happen in the local Python service (see ..\service\).
 * Even if this pane is closed or Word crashes, the service keeps recording and transcribing.
 */

// ——— Formatting parameters; change font sizes and colors here ———
const STYLE = {
  prefixColor: "#9AA0A6",  // gray for timestamp and speaker
  prefixSize: 9,
  textColor: "#000000",
  textSize: 11,
  keyHighlight: "#FFFF00",   // key point: yellow
  defineHighlight: "#C7F0C7", // definition: light green
};

const FLUSH_MS = 500;     // batch writes every 0.5s to avoid bogging down the Word UI with frequent writes
const MAX_LIVE = 200;     // max number of caption lines kept in the pane

let ws = null;
let running = false;
let queue = [];
let writing = false;
let hasWritten = false;
let wordReady = false;
let speakers = {};
// Whether the server is already writing the document via COM (that's the case for a session started from the browser console).
// If so, this side must stay quiet, otherwise the same line gets written twice.
let comWriting = false;

const $ = (id) => document.getElementById(id);

/* ============ Office initialization ============ */
Office.onReady((info) => {
  wordReady = info.host === Office.HostType.Word;
  if (!wordReady) note("请在 Word 中打开本加载项。", true);
  bindUI();
  connect();
  setInterval(flush, FLUSH_MS);
});

function bindUI() {
  $("gap").addEventListener("input", (e) => { $("gapval").textContent = (+e.target.value).toFixed(1); });
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

function start() {
  const dev = $("device").value;
  const opt = $("device").selectedOptions[0];
  send({
    cmd: "start",
    title: $("title").value.trim() || null,
    device: dev === "" ? null : dev,          // "sd:9" (microphone) or "sc:0" (system audio)
    loopback: opt && opt.dataset.kind === "loopback",
    model: $("model").value,
    new_para_gap_ms: Math.round(parseFloat($("gap").value) * 1000),
  });
  $("start").disabled = true;
  $("start").textContent = "正在启动…";
}

/* ============ Communication with the local service ============ */
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
      comWriting = !!(m.word && m.word.ok);
      if (comWriting) {
        $("toWord").checked = false;
        $("toWord").disabled = true;
        note(`这节课由服务端直接写入《${m.word.doc}》，本窗格只显示不写，避免写两遍。`);
      } else {
        $("toWord").disabled = false;
        writeHeader();
      }
      break;

    case "stopped":
      running = false;
      $("start").hidden = false; $("stop").hidden = true; $("subbtns").hidden = true;
      $("setup").hidden = false;
      setConn(true, "已停止");
      note(`已保存 ${m.meta.lines} 句到 ${m.dir}`);
      break;

    case "line": onLine(m); break;
    case "status": onStatus(m); break;
    case "renamed": renameInDoc(m.old, m.name); break;
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
    o.textContent = (d.shaky ? "⚠ " : "") +
      (d.kind === "loopback" ? "🔊 系统声音 · " : "🎤 ") + d.name +
      (d.shaky ? "（这条通道可能开不起来）" : "");
    if (d.id === def) o.selected = true;
    sel.appendChild(o);
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
}

function drawSpeakers(list) {
  const box = $("spklist");
  const sig = list.map((s) => s.id + s.name + s.seconds).join("|");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = "";
  for (const s of list) {
    speakers[s.id] = s.name;
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

/* ============ Captions ============ */
function onLine(m) {
  const box = $("lines");
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

  if ($("toWord").checked && wordReady && !comWriting) {
    if ($("onlyKey").checked && !m.kind) return;
    queue.push(m);
  }
}

/* ============ Writing to Word ============ */
async function writeHeader() {
  if (!wordReady) return;
  const t = $("title").value.trim();
  const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
  try {
    await Word.run(async (ctx) => {
      const p = ctx.document.body.insertParagraph((t ? t + " · " : "") + stamp, Word.InsertLocation.end);
      p.styleBuiltIn = Word.Style.heading2;
      await ctx.sync();
    });
    hasWritten = false; // the first line after the title still starts a new paragraph
  } catch (e) { note("写入标题失败：" + e.message, true); }
}

function applyStyle(range, kind) {
  range.font.color = STYLE.textColor;
  range.font.size = STYLE.textSize;
  range.font.bold = false;
  range.font.highlightColor =
    kind === "key" ? STYLE.keyHighlight : kind === "define" ? STYLE.defineHighlight : null;
}

async function flush() {
  if (writing || !queue.length || !wordReady) return;
  writing = true;
  const items = queue.splice(0, 40);
  try {
    await Word.run(async (ctx) => {
      const body = ctx.document.body;
      let last = null;
      for (const it of items) {
        if (it.new_para || !hasWritten) {
          const p = body.insertParagraph("", Word.InsertLocation.end);
          p.styleBuiltIn = Word.Style.normal;
          const pre = p.insertText(`[${it.ts} ${it.speaker}] `, Word.InsertLocation.end);
          pre.font.color = STYLE.prefixColor;
          pre.font.size = STYLE.prefixSize;
          pre.font.bold = false;
          pre.font.highlightColor = null;
          last = p.insertText(it.text, Word.InsertLocation.end);
          hasWritten = true;
        } else {
          // short pause, keep appending to the previous paragraph so it reads coherently
          last = body.insertText(it.text, Word.InsertLocation.end);
        }
        applyStyle(last, it.kind);
      }
      if ($("follow").checked && last) last.select(Word.SelectionMode.end);
      await ctx.sync();
    });
  } catch (e) {
    note("写入文档失败：" + (e.message || e) + "（内容仍在本地记录中，不会丢）", true);
    // if the write fails, don't retry in a tight loop — pushing back to the queue head only makes it pile up
  }
  writing = false;
}

async function renameInDoc(oldName, newName) {
  // when the COM side renames, it replaces the old name in the document itself; doing it again here would duplicate the change
  if (!wordReady || comWriting || !oldName || oldName === newName) return;
  try {
    await Word.run(async (ctx) => {
      const res = ctx.document.body.search(" " + oldName + "] ", { matchCase: true });
      res.load("items");
      await ctx.sync();
      res.items.forEach((r) => {
        const nr = r.insertText(" " + newName + "] ", Word.InsertLocation.replace);
        nr.font.color = STYLE.prefixColor;
        nr.font.size = STYLE.prefixSize;
      });
      await ctx.sync();
      note(`已把文档里 ${res.items.length} 处「${oldName}」改成「${newName}」`);
    });
  } catch (e) { note("重命名替换失败：" + e.message, true); }
}

/* ============ Misc ============ */
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
