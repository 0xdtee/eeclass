# -*- coding: utf-8 -*-
"""用 DeepSeek 把课堂转写整理成摘要和知识点。

DeepSeek 只有文本大模型（deepseek-chat / deepseek-reasoner，标准 HTTP JSON 接口），
**没有语音识别**——转文字仍然是本机 sherpa-onnx 干的，这里只处理已经转好的文字。

API key 放在服务端配置里，绝不下发给浏览器：页面只调本服务的 /api/summarize，
由服务端代为请求 DeepSeek。这样手机上登录也不用配 key，key 也不会泄露在前端。
"""
import json
import os
import time
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))

SYSTEM = """你是一个帮学生整理课堂笔记的助手。你会收到一节课的逐句转写记录，
每行格式是 [时间 说话人] 内容。转写来自自动语音识别，**会有错别字和同音词错误**，
请结合上下文和学科常识判断真实意思，不要把识别错误当成老师的原话引用。

请输出严格的 JSON，不要有任何额外文字、不要用 markdown 代码块包裹，字段如下：
{
  "summary": "这节课讲了什么，200字以内，说人话，别堆术语",
  "key_points": ["知识点1", "知识点2", ...],
  "formulas": ["课上出现的公式或定理，用文字描述，没有就空数组"],
  "exam_hints": ["老师明确说过要考/是重点的内容，没有就空数组"],
  "questions": ["学生提问及老师的回答要点，没有就空数组"],
  "corrections": ["转写把某个词听错的地方，严格用「听成X应为Y」格式：X是转写里出现的原词(必须和原文一字不差、不带引号)，Y是纠正后的词(不带引号)。不要加任何解释、不要加书名号/引号，X和Y都尽量短(一个词或短语)。没听错、或X和Y一样的，不要输出这一条。没有就空数组"]
}
key_points 控制在 3~8 条，每条一句话，要具体，不要写"介绍了基本概念"这种废话。"""


FLASHCARD_SYS = """你在帮学生把一节课的录音转写做成复习闪卡。转写来自自动语音识别，
**会有错别字和同音词错误**，请结合上下文和学科常识判断真实意思。

输出严格的 JSON，不要 markdown 代码块：
{"flashcards": [{"front": "问题面", "back": "答案面", "ts": "该知识点出现的时间戳"}]}

要求：
· 8~15 张。只做**这节课真的讲过**的内容，不要补充课外知识。
· 正面是一个具体问题（"格林公式成立的条件是什么？"），不是一个词。
· 背面是完整答案，一两句话说清，不要只写个词。
· ts 用转写里那句话的时间戳原样填。
· 老师明说"必考/重点/记一下"的内容优先做成卡片。"""

QUIZ_SYS = """你在帮学生把一节课的录音转写做成自测题。转写来自自动语音识别，
**会有错别字**，请结合上下文判断真实意思。

输出严格的 JSON，不要 markdown 代码块：
{"quiz": [{"question": "题干", "options": ["A","B","C","D"], "answer": 0,
           "why": "为什么选它、错的选项错在哪", "ts": "对应时间戳"}]}

要求：
· 6~12 道单选题，每题 4 个选项，answer 是正确选项的下标（从 0 开始）。
· 只考**这节课讲过**的内容。干扰项要有迷惑性——用常见的混淆点，别编无关的。
· why 里要说清为什么错的选项是错的，这是学生最需要的部分。
· ts 用转写里对应那句话的时间戳。"""

ASK_SYS = """你在回答学生关于某节课的问题。你会收到这节课的逐句转写，
每行格式 [序号|时间 说话人] 内容。转写来自语音识别，**有错别字**，结合上下文判断。

规则：
· **只根据转写内容回答**。转写里没讲到的，直接说"这节课没讲到这个"，不要用常识补。
· 回答要指出依据来自哪几句，用行首的序号。
· 说人话，别堆术语。

输出严格的 JSON，不要 markdown 代码块：
{"answer": "回答正文", "cite_ids": [37, 38]}
cite_ids 是你引用的那几句的序号，最多 5 个，没有就空数组。"""


class DeepSeek:
    def __init__(self, cfg):
        d = (cfg.get("deepseek") or {})
        # key 优先读环境变量，其次读配置文件——别把 key 提交进版本库
        self.api_key = os.environ.get("DEEPSEEK_API_KEY") or d.get("api_key") or ""
        self.base_url = d.get("base_url", "https://api.deepseek.com")
        self.model = d.get("model", "deepseek-chat")
        self.timeout = d.get("timeout_s", 120)
        self.max_chars = d.get("max_input_chars", 60000)

    @property
    def ready(self):
        return bool(self.api_key)

    def _open_retry(self, req, timeout, retries=2):
        """发请求并读回响应体。DeepSeek 偶发 5xx/超时/网络抖动 → 退避后自动重试。
        一次性调用(摘要/自测/追问)用 retries>=2;实时调用(纠错/分句)用 retries=0 快速失败。"""
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        delay = 1.5
        for attempt in range(retries + 1):
            try:
                with opener.open(req, timeout=timeout) as resp:
                    return resp.read()
            except urllib.error.HTTPError as e:
                # 429/5xx 是 DeepSeek 那边临时忙,值得重试;4xx(如鉴权)重试也没用,直接抛
                if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(delay); delay *= 2; continue
                raise
            except (urllib.error.URLError, TimeoutError, OSError):
                if attempt < retries:
                    time.sleep(delay); delay *= 2; continue
                raise

    def _chat(self, system, user, temperature=0.3, retries=2):
        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.base_url.rstrip("/") + "/chat/completions", data=payload,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"})
        data = json.loads(self._open_retry(req, self.timeout, retries).decode("utf-8"))
        text = data["choices"][0]["message"]["content"]
        try:
            out = json.loads(text)
        except json.JSONDecodeError:
            t = text.strip().strip("`")
            if t.lower().startswith("json"):
                t = t[4:]
            out = json.loads(t)
        out["_usage"] = data.get("usage", {})
        return out

    def correct(self, text, topic="", timeout_s=15):
        """实时纠错:只改一句里明显的同音/近音错字,返回纠正后的句子。
        topic=课程标题(如"高等数学"),给模型学科上下文,往对应专业术语方向纠。
        失败、没配 key、或模型跑偏(长度差太多)都退回原文,绝不删内容。"""
        text = (text or "").strip()
        if not self.api_key or len(text) < 4:
            return text
        sys_prompt = (
            "你是中文语音转写纠错助手。用户给你一句语音识别(ASR)的结果,可能有识别错误:"
            "①同音/近音错字(如'映射'听成'影射'、'非空'听成'飞空'、'格林公式'听成'格林公司');"
            "②发音相近导致的词被识别成读不通的词(如'级数'听成'句真'、'收敛'听成'收链');"
            "③专业术语被识别成日常词。请把这些**明显是识别错、导致读起来不通顺**的词,"
            "按其发音就近改回正确的词(尤其结合下面的学科)。要求:严格保持原意与口语风格、"
            "字数基本不变、不要增删内容或解释、**保持原有标点不变(不新增/删除/修改任何标点)**。"
            "**没有明显错误就一字不改原样返回**。直接输出纠正后的这一句,不要加引号。")
        topic = (topic or "").strip()
        if topic:
            sys_prompt += (
                f"\n本次录音的主题是「{topic}」(可能是课程、会议、讲座、访谈、培训等任意场景)。"
                "请先根据这个主题判断它属于哪个领域,再优先往该领域的常用术语方向纠正,而不是日常词。"
                "例如:高等数学→'映射/非空/导数/矩阵';大学物理→'向量/动量/电场';"
                "项目会议/工作会议→'需求/迭代/上线/复盘/里程碑/闭环/对齐';"
                "财务→'摊销/应收/现金流/计提';医学→'心肌/血栓/剂量/病灶';"
                "法律→'条款/善意第三人/管辖/抗辩';编程→'接口/部署/缓存/并发'。"
                "如果主题里看不出明确领域,就按通用中文常识处理。")
        payload = json.dumps({
            "model": self.model,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": text},
            ],
            "temperature": 0.2,
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")
        try:
            req = urllib.request.Request(
                self.base_url.rstrip("/") + "/chat/completions", data=payload,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {self.api_key}"})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=timeout_s) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            out = (data["choices"][0]["message"]["content"] or "").strip().strip('「」""\'` ')
        except Exception:
            return text
        # 模型若跑偏(长度差太多)就不信,退回原文
        if not out or abs(len(out) - len(text)) > max(6, int(len(text) * 0.4)):
            return text
        return out

    def translate(self, text, topic="", timeout_s=12):
        """把英文/中英混说的一句翻成自然简洁的中文,当字幕用。返回中文译文;
        没配 key / 失败 / 本来就是中文无需翻,返回 ""。"""
        text = (text or "").strip()
        if not self.api_key or len(text) < 2:
            return ""
        sys_prompt = (
            "你是课堂字幕的翻译。把用户给的这句英文(或中英混说)翻成**自然、简洁、口语**的中文,"
            "作为原句下面的一行字幕。只输出中文译文这一句,不要解释、不要注音、不要加引号、不要重复原文。"
            "如果整句本来就是中文、没有需要翻译的英文内容,就输出空。")
        topic = (topic or "").strip()
        if topic:
            sys_prompt += f"\n本次场景/学科是「{topic}」,专业术语按该领域的习惯译法翻。"
        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": sys_prompt},
                         {"role": "user", "content": text}],
            "temperature": 0.2,
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")
        try:
            req = urllib.request.Request(
                self.base_url.rstrip("/") + "/chat/completions", data=payload,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {self.api_key}"})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=timeout_s) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            out = (data["choices"][0]["message"]["content"] or "").strip().strip('「」""\'` ')
        except Exception:
            return ""
        # 译文里不该全是英文/空;简单挡一下
        if not out or out == text:
            return ""
        return out

    def segment(self, fragments, topic="", timeout_s=12):
        """智能分句:把连续的 ASR 口语碎片(每个是一次 VAD 停顿切出来的)按语意合并成完整句子。
        fragments: ["碎片1","碎片2",...] 时间顺序。返回 dict:
          {"commit":[{"n":<吃掉开头几个碎片>,"text":"<合成的完整句,带标点>"}...],"tail_n":<剩下没说完的碎片数>}
          语意没说完的结尾碎片留在 tail、先不成句。sum(n)+tail_n == 碎片数。
        没配 key / 失败返回 None(调用方退回:每个碎片各成一行)。"""
        if not self.api_key or not fragments:
            return None
        numbered = "\n".join(f"[{i}] {t}" for i, t in enumerate(fragments))
        sys_prompt = (
            "你在做中文语音转写的实时分句。下面是按时间先后排列的若干 ASR 碎片,每个碎片是说话人"
            "一次停顿切出来的——一句话可能被切成好几段,一段里也可能含好几句。规则:**只要开头连续的"
            "碎片已经能凑成一个可以合理收尾(末尾加上 。/?/! 读起来通顺)的句子,就立刻把它断成一句、"
            "另起一行**;宁可断成短句,也不要为了凑更长的句子而把好几句并在一起——每个 commit 只放"
            "**一个**句子。碎片的先后顺序和字词都不要改、不要增删内容,只做合并成句与加末尾标点。"
            "只有当结尾剩下的碎片还凑不出任何一个能收尾的完整句子(明显是半句)时,才把它们留在 tail、"
            "先不要成句。"
            '严格输出 JSON:{"commit":[{"n":<吃掉开头几个碎片的个数>,"text":"<合成的一句,带末尾标点>"}...],'
            '"tail_n":<结尾没说完、保留的碎片个数>}。要求所有 commit 的 n 之和 加 tail_n 恰好等于碎片总数;'
            "若整段都还凑不出一个完整句子,commit 为空数组、tail_n 等于碎片总数。只输出 JSON,不要解释。")
        topic = (topic or "").strip()
        if topic:
            sys_prompt += f"\n本次录音主题是「{topic}」,据此判断句子是否完整。"
        try:
            out = self._chat(sys_prompt, numbered, temperature=0.1, retries=0)
        except Exception:
            return None
        return out if isinstance(out, dict) else None

    def _body(self, lines, with_ids=False):
        rows = []
        for l in lines:
            if not l.get("text"):
                continue
            head = (f"[{l.get('id','')}|{l.get('ts','')} {l.get('speaker','')}]"
                    if with_ids else f"[{l.get('ts','')} {l.get('speaker','')}]")
            rows.append(f"{head} {l['text']}")
        body = "\n".join(rows)
        if len(body) > self.max_chars:
            half = self.max_chars // 2
            body = body[:half] + "\n…（中间略）…\n" + body[-half:]
        return body

    def _require_key(self):
        if not self.ready:
            raise RuntimeError(
                "还没配 DeepSeek API key。把 key 填到 service/config.json 的 "
                "deepseek.api_key，或设环境变量 DEEPSEEK_API_KEY，然后重启服务。")

    def study(self, lines, mode, title=None):
        """mode: flashcards | quiz"""
        self._require_key()
        sys_prompt = FLASHCARD_SYS if mode == "flashcards" else QUIZ_SYS
        user = (f"课程：{title}\n\n" if title else "") + "逐句转写：\n" + self._body(lines)
        out = self._chat(sys_prompt, user, temperature=0.5)
        # 把时间戳映射回秒数，前端要靠它跳转音频
        ts2start = {l.get("ts"): l.get("start", 0) for l in lines if l.get("ts")}
        for item in out.get("flashcards", []) or out.get("quiz", []) or []:
            item["start"] = ts2start.get(item.get("ts"), 0)
        return out

    def ask(self, lines, question, history=None, title=None):
        self._require_key()
        convo = ""
        for h in (history or [])[-6:]:
            role = "学生" if h.get("role") == "user" else "你"
            convo += f"{role}：{h.get('content','')}\n"
        user = ((f"课程：{title}\n\n" if title else "")
                + "逐句转写：\n" + self._body(lines, with_ids=True)
                + (f"\n\n之前的对话：\n{convo}" if convo else "")
                + f"\n\n学生的问题：{question}")
        out = self._chat(ASK_SYS, user, temperature=0.2)
        by_id = {l.get("id"): l for l in lines}
        out["cites"] = [
            {"line_id": i, "ts": by_id[i].get("ts", ""), "start": by_id[i].get("start", 0),
             "text": by_id[i].get("text", "")}
            for i in (out.pop("cite_ids", None) or []) if i in by_id
        ]
        return out

    def summarize(self, lines, title=None, board=""):
        """lines: [{ts, speaker, text, kind}];board: 板书/PPT 识别内容。返回 dict。"""
        if not self.ready:
            raise RuntimeError(
                "还没配 DeepSeek API key。把 key 填到 service/config.json 的 "
                "deepseek.api_key，或设环境变量 DEEPSEEK_API_KEY，然后重启服务。")

        body = "\n".join(f"[{l.get('ts','')} {l.get('speaker','')}] {l.get('text','')}"
                         for l in lines if l.get("text"))
        if len(body) > self.max_chars:
            # 超长就掐头去尾保留中间以外的部分：优先留开头（引入）和结尾（总结）
            half = self.max_chars // 2
            body = body[:half] + "\n…（中间略）…\n" + body[-half:]

        board_sec = ""
        if board and board.strip():
            board_sec = ("\n\n【课堂板书/PPT 识别内容(重要,老师写在板书上的往往是重点)】\n"
                         + board.strip()[:8000])
        user = (f"课程：{title}\n\n" if title else "") + "逐句转写：\n" + body + board_sec
        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": user}],
            "temperature": 0.3,
            "response_format": {"type": "json_object"},
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")

        req = urllib.request.Request(
            self.base_url.rstrip("/") + "/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"})
        # DeepSeek 偶发 5xx/超时会自动重试(_open_retry 内部绕开系统代理)。
        data = json.loads(self._open_retry(req, self.timeout, retries=2).decode("utf-8"))
        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        try:
            out = json.loads(text)
        except json.JSONDecodeError:
            # 模型偶尔还是会套一层 ```json，兜一下
            t = text.strip().strip("`")
            if t.lower().startswith("json"):
                t = t[4:]
            out = json.loads(t)
        out["_usage"] = usage
        out["_model"] = self.model
        return out
