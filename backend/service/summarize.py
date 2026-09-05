# -*- coding: utf-8 -*-
"""Use DeepSeek to turn a classroom transcript into a summary and key points.

DeepSeek only has text LLMs (deepseek-chat / deepseek-reasoner, standard HTTP JSON interface)
and **no speech recognition**—speech-to-text is still done locally by sherpa-onnx; this module only handles the already-transcribed text.

The API key lives in server-side config and is never sent to the browser: the page only calls this service's /api/summarize,
and the server makes the DeepSeek request on its behalf. This way logging in on a phone needs no key, and the key never leaks to the frontend.
"""
import json
import os
import re
import time
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))

SYSTEM = """你是一个帮学生整理课堂笔记的助手。你会收到一节课的逐句转写记录，
每行格式是 [时间 说话人] 内容。转写来自自动语音识别，**会有错别字和同音词错误**，
请结合上下文和学科常识判断真实意思，不要把识别错误当成老师的原话引用。

**极其重要：只能根据转写里真实出现的内容来总结，绝对不许编造、脑补、或添加转写中根本没提到的知识点、术语或内容。** 转写讲了什么就总结什么——哪怕不是正式上课、只是日常对话或闲聊，也要如实把说到的话题和要点概括出来（比如聊了坐地铁、逛街、几家店，就照实写成"聊了坐地铁的花费、逛街和几家咖啡店餐厅"这类）。**只要转写里有任何话（哪怕只是打招呼、测试麦克风、问「能听到吗」、说几句闲话），都必须如实把说了什么概括成摘要**（例如「测试录音：打招呼、确认麦克风是否正常、测试识别与断句效果」）——绝不要因为内容简短或随意就拒绝总结。只有当转写**完全是空的、一个字都没有**时，才把 summary 写成「本次录音内容过少，无法生成摘要」，并把 key_points、formulas、exam_hints、questions、corrections 全部返回空数组 `[]`。总之：有内容就如实总结，绝不凭空捏造转写里没有的东西。

**要通读全文、覆盖整节课从头到尾的每个方面/环节**，不要只总结开头、也不要只写老师口头说"最重要"的那一条——转写里讲到的每个话题都要如实概括进去，尤其别漏掉后半段和结尾的内容。这既可能是学术课，也可能是通知/动员/班会等事务性内容；对**事务性内容，每一条具体的规定、安排、时间、地点、联系方式、注意事项、要求都要作为一个要点单独列出**。

请输出严格的 JSON，不要有任何额外文字、不要用 markdown 代码块包裹，字段如下：
{
  "summary": "这节课讲了什么，把主要方面都覆盖到，300字以内，说人话，别堆术语",
  "key_points": ["知识点1", "知识点2", ...],
  "formulas": ["课上出现的公式或定理，用文字描述，没有就空数组"],
  "exam_hints": ["老师明确说过要考/是重点的内容，没有就空数组"],
  "questions": ["每条是一句话字符串(不要用对象),写成「学生问X，老师答Y」这种；没有就空数组"],
  "corrections": ["转写把某个词听错的地方，严格用「听成X应为Y」格式：X是转写里出现的原词(必须和原文一字不差、不带引号)，Y是纠正后的词(不带引号)。不要加任何解释、不要加书名号/引号，X和Y都尽量短(一个词或短语)。没听错、或X和Y一样的，不要输出这一条。没有就空数组"]
}
key_points 数量**随内容多少而定**：内容丰富就多列（可到 15~20 条），内容少就少列——宁可覆盖全、不要漏；每条一句话、要具体，不要写"介绍了基本概念"这种废话。
corrections **最多列 15 条最明显、最影响理解的**即可，不要逐句罗列(长录音里同类错字挑代表性的就行)，其余字段各自精简。"""


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


def _close_truncated(t):
    """Repair truncated JSON as best we can: close unterminated strings, drop dangling keys/commas/backslashes, and close brackets per the bracket stack."""
    stack = []
    in_str = False
    esc = False
    for ch in t:
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == '{':
                stack.append('}')
            elif ch == '[':
                stack.append(']')
            elif ch in '}]' and stack:
                stack.pop()
    s = t
    if esc:                                    # trailing dangling backslash
        s = s[:-1]
    if in_str:                                 # unterminated string, add a quote
        s += '"'
    s = re.sub(r'[,\s]*$', '', s)              # trailing comma/whitespace
    s = re.sub(r'"[^"]*"\s*:\s*$', '', s)      # dangling "key": (cut off before the value even started)
    s = re.sub(r'[,\s]*$', '', s)
    for closer in reversed(stack):
        s += closer
    return s


def _loads_forgiving(text):
    """Fault-tolerant parse of the model's JSON: handles ```json wrapping, unescaped LaTeX backslashes, and truncated output."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t[:4].lower() == "json":
            t = t[4:]

    def fix_bs(x):
        return re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', x)   # escape LaTeX backslashes to \\ to keep the JSON valid

    candidates = [t, fix_bs(t), _close_truncated(t), _close_truncated(fix_bs(t))]
    last = None
    for c in candidates:
        try:
            return json.loads(c)
        except json.JSONDecodeError as e:
            last = e
    raise last


def _as_text(x):
    """Coerce one list item into a display string. The model sometimes returns a field like `questions` as
    objects ({question, answer}) instead of strings; without this the frontend renders "[object Object]"."""
    if isinstance(x, str):
        return x.strip()
    if isinstance(x, dict):
        q = x.get("question") or x.get("q") or x.get("问") or x.get("front") or x.get("term") or ""
        a = x.get("answer") or x.get("a") or x.get("答") or x.get("back") or x.get("definition") or ""
        q, a = str(q).strip(), str(a).strip()
        if q and a:
            return f"问:{q} 答:{a}"
        if q or a:
            return q or a
        parts = [str(v).strip() for v in x.values()
                 if isinstance(v, (str, int, float)) and str(v).strip()]
        return " ".join(parts)
    if isinstance(x, list):
        return " ".join(s for s in (_as_text(i) for i in x) if s)
    if x is None:
        return ""
    return str(x).strip()


def _str_list(v):
    """Normalize a field that should be a list of strings into exactly that (dropping empties)."""
    if v is None:
        return []
    if not isinstance(v, list):
        v = [v]
    return [s for s in (_as_text(i) for i in v) if s]


TRANS_LANG_NAMES = {
    "zh": "Chinese", "en": "English", "fr": "French",
    "de": "German", "it": "Italian", "ja": "Japanese", "ko": "Korean",
    "es": "Spanish", "ru": "Russian",
}


def lang_note(lang):
    """Instruction appended to summary/course prompts so the AI writes its output in the UI language."""
    if lang == "en":
        return ("\n\nOUTPUT LANGUAGE: write every text value in the JSON (summary, key_points, formulas, "
                "exam_hints, questions, and any question/option/answer text) in ENGLISH, regardless of the "
                "transcript's language. Keep the JSON keys unchanged. EXCEPTION: the 'corrections' array must "
                "keep its exact original format 「听成X应为Y」 with the raw Chinese transcript words unchanged "
                "(do not translate it).")
    if lang == "zh-Hant":
        return ("\n\n輸出語言:JSON 裡所有文字內容(summary、key_points、formulas、exam_hints、questions、"
                "題目/選項/答案等)一律用**繁體中文**書寫。例外:corrections 陣列保留原本的「听成X应为Y」"
                "簡體格式與轉寫原詞,不要改。")
    return ""   # zh-Hans: default (Chinese)


class DeepSeek:
    def __init__(self, cfg):
        d = (cfg.get("deepseek") or {})
        # read the key from an env var first, then the config file—don't commit the key into version control
        self.api_key = os.environ.get("DEEPSEEK_API_KEY") or d.get("api_key") or ""
        self.base_url = d.get("base_url", "https://api.deepseek.com")
        self.model = d.get("model", "deepseek-chat")
        self.timeout = d.get("timeout_s", 120)
        self.max_chars = d.get("max_input_chars", 60000)

    @property
    def ready(self):
        return bool(self.api_key)

    def _open_retry(self, req, timeout, retries=2):
        """Send the request and read back the response body. DeepSeek occasionally returns 5xx/timeouts/network jitter → auto-retry after backoff.
        One-shot calls (summary/self-test/follow-up) use retries>=2; real-time calls (correction/segmentation) use retries=0 to fail fast."""
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        delay = 1.5
        for attempt in range(retries + 1):
            try:
                with opener.open(req, timeout=timeout) as resp:
                    return resp.read()
            except urllib.error.HTTPError as e:
                # 429/5xx means DeepSeek is temporarily busy and is worth retrying; 4xx (e.g. auth) won't be helped by retrying, so raise directly
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
            "max_tokens": 8192,
            "response_format": {"type": "json_object"},
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.base_url.rstrip("/") + "/chat/completions", data=payload,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"})
        data = json.loads(self._open_retry(req, self.timeout, retries).decode("utf-8"))
        text = data["choices"][0]["message"]["content"]
        out = _loads_forgiving(text)
        out["_usage"] = data.get("usage", {})
        return out

    def correct(self, text, topic="", timeout_s=15):
        """Real-time correction: fix only the obvious homophone/near-homophone errors in one sentence and return the corrected sentence.
        topic = course title (e.g. "Advanced Mathematics"), gives the model subject context to steer toward the right domain terms.
        On failure, no key, or a model that goes off the rails (length differs too much), fall back to the original—never delete content."""
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
        # if the model goes off the rails (length differs too much), don't trust it, fall back to the original
        if not out or abs(len(out) - len(text)) > max(6, int(len(text) * 0.4)):
            return text
        return out

    def translate(self, text, topic="", timeout_s=12):
        """Translate one English or mixed English-Chinese sentence into natural, concise Chinese for use as a caption. Returns the Chinese translation;
        with no key / on failure / when it's already Chinese and needs no translation, returns ""."""
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
        # the translation shouldn't be all English/empty; a simple guard
        if not out or out == text:
            return ""
        return out

    def translate_to_english(self, text, topic="", timeout_s=12):
        """Translate one Chinese sentence into natural, concise English for a caption line under the original.
        Returns the English translation; with no key / on failure / nothing to translate, returns ""."""
        text = (text or "").strip()
        if not self.api_key or len(text) < 1:
            return ""
        sys_prompt = (
            "You are translating live classroom captions. Translate the user's Chinese sentence into natural, "
            "concise, spoken English, to sit as one caption line under the original. Output only the English "
            "translation, no explanation, no quotes, no pinyin, and don't repeat the Chinese. If the sentence "
            "is already English and needs no translation, output nothing.")
        topic = (topic or "").strip()
        if topic:
            sys_prompt += f"\nThe subject/context is 「{topic}」; use that field's conventional English terminology."
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
        if not out or out == text:
            return ""
        return out

    def translate_general(self, text, from_lang, to_lang, topic="", timeout_s=12):
        """Translate one caption sentence from `from_lang` into `to_lang` (both are codes in TRANS_LANG_NAMES),
        for a caption line under the original. Returns the translation; with no key / on failure / nothing to
        translate / from == to, returns ""."""
        text = (text or "").strip()
        src = TRANS_LANG_NAMES.get(from_lang)
        dst = TRANS_LANG_NAMES.get(to_lang)
        if not self.api_key or len(text) < 1 or not src or not dst or from_lang == to_lang:
            return ""
        sys_prompt = (
            f"You are translating live classroom captions. Translate the user's {src} sentence into natural, "
            f"concise, spoken {dst}, to sit as one caption line under the original. Output only the {dst} "
            "translation, no explanation, no quotes, no phonetic notation, and don't repeat the original. If the "
            f"sentence is already {dst} and needs no translation, output nothing.")
        topic = (topic or "").strip()
        if topic:
            sys_prompt += f"\nThe subject/context is 「{topic}」; use that field's conventional {dst} terminology."
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
        if not out or out == text:
            return ""
        return out

    def translate_to(self, text, to_lang, topic="", timeout_s=12):
        """Translate one caption sentence into `to_lang` (a code in TRANS_LANG_NAMES), auto-detecting the
        source. Returns the translation; if the sentence is already in to_lang (or on no key / failure /
        unknown language), returns "" -- so the meeting translator can translate a sentence into every
        selected language and the one that matches the spoken language just drops out."""
        text = (text or "").strip()
        dst = TRANS_LANG_NAMES.get(to_lang)
        if not self.api_key or len(text) < 1 or not dst:
            return ""
        sys_prompt = (
            f"You are translating live meeting captions. Translate the user's sentence (in whatever "
            f"language it is spoken) into natural, concise, spoken {dst}, to sit as one caption line. "
            f"Output only the {dst} translation, one line, no explanation, no quotes, no phonetic "
            f"notation, and don't repeat the original. If the sentence is ALREADY in {dst} and needs no "
            f"translation, output nothing.")
        topic = (topic or "").strip()
        if topic:
            sys_prompt += f"\nThe subject/context is 「{topic}」; use that field's conventional {dst} terminology."
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
        if not out or out == text:
            return ""
        return out

    def translate_multi(self, text, langs, topic="", timeout_s=15):
        """Translate ONE caption sentence into every language in `langs` (codes in TRANS_LANG_NAMES) in a
        single call, and detect which of them is the spoken/source language. Because all target versions come
        from the same source sentence, they line up as one row and read more accurately than N independent
        real-time streams. Returns {"src": <code in langs or "">, "translations": {code: text, ...}} with an
        entry for EVERY requested code (the source code's value is the cleaned original). {} on failure/no key."""
        text = (text or "").strip()
        codes = [c for c in (langs or []) if c in TRANS_LANG_NAMES]
        if not self.api_key or len(text) < 1 or not codes:
            return {}
        names = ", ".join(f"{c} = {TRANS_LANG_NAMES[c]}" for c in codes)
        sys_prompt = (
            "You are cleaning up and translating a live meeting caption. The sentence below was produced by "
            "speech recognition and may contain small errors; infer the intended meaning. "
            f"The target languages are: {names}. "
            "Detect which target language is the one actually spoken (the source). "
            "Output ONLY a JSON object of the form "
            '{\"src\": \"<the code that is the spoken language, or empty string if none of them>\", '
            '\"translations\": {\"<code>\": \"<one natural, concise, spoken line>\"}} '
            "with an entry in translations for EVERY target code. For the code that equals the spoken "
            "language, put the cleaned original sentence. No quotes, no phonetic notation, no explanation.")
        topic = (topic or "").strip()
        if topic:
            sys_prompt += f"\nThe subject/context is 「{topic}」; use that field's conventional terminology."
        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": sys_prompt},
                         {"role": "user", "content": text}],
            "temperature": 0.2,
            "stream": False,
            "response_format": {"type": "json_object"},
        }, ensure_ascii=False).encode("utf-8")
        try:
            req = urllib.request.Request(
                self.base_url.rstrip("/") + "/chat/completions", data=payload,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {self.api_key}"})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=timeout_s) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            out = _loads_forgiving(data["choices"][0]["message"]["content"])
        except Exception:
            return {}
        if not isinstance(out, dict):
            return {}
        tr = out.get("translations") or {}
        translations = {c: (str(tr.get(c, "")).strip().strip('「」""\'` ')) for c in codes if tr.get(c)}
        src = out.get("src") if out.get("src") in codes else ""
        return {"src": src, "translations": translations}

    def highlight_lines(self, texts, topic="", timeout_s=60):
        """Post-class supplementary highlighting: given a class transcript (list of sentence strings), decide
        which lines are 定义(define) / 重点(key) -- catching the real definitions the real-time rules miss
        (multi-sentence, keyword-free ones), while staying strict so it doesn't over-mark a whole passage.
        Definitions are returned as ranges (a definition usually spans several fragmented lines); key points as
        single most-representative lines. Returns {"define": [idx...], "key": [idx...]} of 0-based indices into
        `texts`; {} on no key / failure. Caps are enforced in code so a runaway model can't yellow the whole class."""
        texts = [(x or "").strip() for x in (texts or [])]
        n = len(texts)
        if not self.api_key or not any(texts):
            return {}
        numbered = "\n".join(f"{i}: {tx}" for i, tx in enumerate(texts) if tx)
        numbered = numbered[: getattr(self, "max_chars", 20000)]
        max_def = max(2, n // 30)    # definition ranges
        max_key = max(3, n // 25)    # key lines
        sys_prompt = (
            f"你是帮大学生做复习重点的助手。下面是一节课 {n} 句的逐句语音转写(每行开头是编号),"
            "里面有识别错误、口语、半句、重复,请自行甄别。挑出两类、只挑真正有复习价值的:\n"
            "- 定义 define:老师正式给出的概念定义或定理/性质的陈述。它常被切成连续几句,用**区间** [起,止] "
            "表示(闭区间,止句也算)。每个区间紧凑(一般≤5句),只覆盖真正是定义内容的句子,不要把后面的举例、"
            "解释、口语都包进来;「X 的定义」「下面讲」这种引子不要包含。\n"
            "- 重点 key:老师强调的关键结论、性质、易考点。**同一个知识点只标最完整、最有代表性的那一句**(单个编号),"
            "不要把它前后的铺垫、重复、举例、口语确认都标上。\n"
            f"严格控制数量(宁缺毋滥):这节课定义最多 {max_def} 个区间、重点最多 {max_key} 句。\n"
            "绝对不要标:反问句(理解吧?对不对?)、口语确认与语气词(对/是啊/所以呢/啊)、明显识别乱码、"
            "不完整的半句、举例演算过程、与知识点无关的闲话。自检:一句删掉后若不影响学生理解该知识点,就不要标。\n"
            "只输出 JSON,形如 {\"define\":[[35,39],[54,56]],\"key\":[98,110]}。")
        if (topic or "").strip():
            sys_prompt += f"\n本节课主题:「{topic.strip()}」。"
        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": sys_prompt},
                         {"role": "user", "content": numbered}],
            "temperature": 0,
            "stream": False,
            "response_format": {"type": "json_object"},
        }, ensure_ascii=False).encode("utf-8")
        try:
            req = urllib.request.Request(
                self.base_url.rstrip("/") + "/chat/completions", data=payload,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {self.api_key}"})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=timeout_s) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            out = _loads_forgiving(data["choices"][0]["message"]["content"])
        except Exception:
            return {}
        if not isinstance(out, dict):
            return {}

        # define: list of [start, end] ranges -> expand, drop over-long ranges, cap the number of ranges
        define = []
        ranges = out.get("define") or []
        if isinstance(ranges, list):
            for rg in ranges[:max_def]:
                if isinstance(rg, list) and rg:
                    try:
                        a, b = int(rg[0]), int(rg[-1])
                    except Exception:
                        continue
                    if a > b:
                        a, b = b, a
                    if b - a > 6:        # a real definition isn't 8+ fragments; a runaway range -> skip
                        continue
                    define += [i for i in range(a, b + 1) if 0 <= i < n]
                elif isinstance(rg, (int, float)):   # tolerate a bare index
                    if 0 <= int(rg) < n:
                        define.append(int(rg))
        # key: flat list of single lines -> cap the count
        key = []
        for v in (out.get("key") or []):
            try:
                iv = int(v)
            except Exception:
                continue
            if 0 <= iv < n and iv not in key:
                key.append(iv)
            if len(key) >= max_key:
                break
        define = sorted(set(define))
        key = [i for i in key if i not in define]   # a definition line shouldn't also be a stray key
        return {"define": define, "key": key}

    def translate_wu_to_mandarin(self, text, topic="", timeout_s=12):
        """Translate a per-sentence Shanghainese (Wu) transcript into standard Mandarin, as a caption line beneath the original.
        Returns the Mandarin translation; with no key / on failure / on an empty sentence, returns "" (the caller then shows only the Wu original)."""
        text = (text or "").strip()
        if not self.api_key or len(text) < 2:
            return ""
        sys_prompt = (
            "你在把上海话(吴语)的逐句转写翻译成规范普通话。只输出翻译后的普通话句子,"
            "忠实原意,不要解释、不要加引号。")
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
        if not out or out == text:
            return ""
        return out

    def polish_dialect(self, text, topic="", timeout_s=12):
        """Polish a per-sentence Mandarin transcription of DIALECT speech (from fun-asr-realtime) into fluent,
        standard written Mandarin -- in place. The dialect model already outputs Mandarin, but wording can be
        rough or keep dialect-specific phrasing; this smooths it while staying faithful to the meaning.
        Returns the polished sentence; with no key / on failure / no change, returns "" (caller keeps the original)."""
        text = (text or "").strip()
        if not self.api_key or len(text) < 2:
            return ""
        sys_prompt = (
            "下面是对方言语音的普通话转写(来自语音识别),可能有方言用词或不通顺的地方。"
            "把它改写成通顺、规范的书面普通话,忠实原意,不要解释、不要加引号、不要改变说话内容,只输出改写后的句子。")
        topic = (topic or "").strip()
        if topic:
            sys_prompt += f"\n本次场景/学科是「{topic}」,专业术语按该领域的习惯写法。"
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
        if not out or out == text:
            return ""
        return out

    def segment(self, fragments, topic="", timeout_s=12):
        """Smart segmentation: merge consecutive ASR speech fragments (each cut out by one VAD pause) into complete sentences by meaning.
        fragments: ["fragment1","fragment2",...] in time order. Returns a dict:
          {"commit":[{"n":<how many leading fragments to consume>,"text":"<the assembled complete sentence, with punctuation>"}...],"tail_n":<count of remaining unfinished fragments>}
          Trailing fragments whose meaning isn't finished stay in the tail and don't form a sentence yet. sum(n)+tail_n == fragment count.
        With no key / on failure, returns None (the caller falls back: each fragment becomes its own line)."""
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
        # map the timestamps back to seconds; the frontend needs it to seek the audio
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

    def summarize(self, lines, title=None, board="", lang="zh-Hans", syllabus=None):
        """lines: [{ts, speaker, text, kind}]; board: recognized whiteboard/slide content.
        lang: UI language for the OUTPUT text ('zh-Hans' | 'zh-Hant' | 'en').
        syllabus: optional stored syllabus dict for this course (authoritative textbook/chapter reference).
        Returns a dict."""
        if not self.ready:
            raise RuntimeError(
                "还没配 DeepSeek API key。把 key 填到 service/config.json 的 "
                "deepseek.api_key，或设环境变量 DEEPSEEK_API_KEY，然后重启服务。")

        body = "\n".join(f"[{l.get('ts','')} {l.get('speaker','')}] {l.get('text','')}"
                         for l in lines if l.get("text"))
        if len(body) > self.max_chars:
            # if too long, drop the middle and keep everything else: prefer keeping the opening (intro) and ending (summary)
            half = self.max_chars // 2
            body = body[:half] + "\n…（中间略）…\n" + body[-half:]

        board_sec = ""
        if board and board.strip():
            board_sec = ("\n\n【课堂板书/PPT 识别内容(重要,老师写在板书上的往往是重点)】\n"
                         + board.strip()[:8000])
        # Textbook cross-reference: if this is an academic subject, ground the summary in its standard textbook.
        book_sec = ""
        if (title or "").strip():
            book_sec = (
                f"\n\n【教材对照】课程标题是「{title.strip()}」。如果它是一门有标准教材的学科课程"
                "(如高等数学、大学物理、线性代数、概率论、数据结构、有机化学、微观经济学、大学英语 等),"
                "请结合该课程**通用教材的章节体系**来理解并组织这节课的内容:\n"
                "① 在 summary 末尾用一句话注明「本节对应教材:《教材名》第X章 章节名(如涉及多章就都列上)」;\n"
                "② 凡是属于教材核心知识(概念定义、定理、公式、重要方法)的 key_points,在**该条开头加上「【教材】」**"
                "(可再带章节,如「【教材·第3章】...」);不属于教材内容的要点(如老师的提醒、作业安排、闲话)不要加这个标记。\n"
                "如果这门课不是学科课(如班会、通知、军训动员、测试录音等),就完全忽略本段——不要提教材、不要加【教材】标记。")
            if isinstance(syllabus, dict) and syllabus.get("chapters"):
                tbs = "、".join([str(x) for x in (syllabus.get("textbooks") or [])][:3])
                chs = "；".join(str(c.get("title", "")).strip()
                                for c in (syllabus.get("chapters") or [])[:40] if c.get("title"))
                book_sec += (f"\n已知本课教材与章节(以此为准,不要臆造):教材={tbs or '(未注明)'};"
                             f"章节顺序:{chs}。")
        user = (f"课程：{title}\n\n" if title else "") + "逐句转写：\n" + body + board_sec + book_sec
        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": SYSTEM + lang_note(lang)},
                         {"role": "user", "content": user}],
            "temperature": 0.3,
            "max_tokens": 8192,
            "response_format": {"type": "json_object"},
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")

        req = urllib.request.Request(
            self.base_url.rstrip("/") + "/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"})
        # DeepSeek's occasional 5xx/timeouts are auto-retried (_open_retry internally bypasses the system proxy).
        data = json.loads(self._open_retry(req, self.timeout, retries=2).decode("utf-8"))
        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        try:
            out = json.loads(text)
        except json.JSONDecodeError:
            out = _loads_forgiving(text)   # handles ```json wrapping / LaTeX backslashes / truncated output
        # Normalize the string-list fields: the model occasionally returns objects (e.g. questions as
        # {question, answer}), which would render as "[object Object]" in the UI. Coerce everything to strings.
        for f in ("key_points", "formulas", "exam_hints", "questions", "corrections"):
            if f in out:
                out[f] = _str_list(out[f])
        if "summary" in out and not isinstance(out["summary"], str):
            out["summary"] = _as_text(out["summary"])
        out["_usage"] = usage
        out["_model"] = self.model
        return out


def _llm_relabel_speakers(ds, lines, vp_groups=None):
    """Re-assign each line's speaker from CONVERSATIONAL LOGIC (who asks/answers, addressing, first person,
    topic/tone coherence), grounded by an optional per-line voiceprint group hint (AG-LSEC style: text logic +
    audio cue). `ds` is a ready DeepSeek. Returns a list of speaker-name strings (one per line) or None."""
    rows = [(i, (l.get("text") or "").strip()) for i, l in enumerate(lines) if (l.get("text") or "").strip()]
    if len(rows) < 2 or not getattr(ds, "ready", False):
        return None
    if vp_groups:
        body = "\n".join(f"{n}. [声纹组{vp_groups[i]}] {t}" for n, (i, t) in enumerate(rows, 1))
        hint = ("\n每句前的【声纹组N】是按音色初步聚的类(远场时不准,仅供参考):同组更可能是同一个人、不同组更可能是不同人;"
                "请以【对话逻辑】为主、声纹组为辅综合判断,声纹组明显和对话逻辑冲突时以对话逻辑为准。")
    else:
        body = "\n".join(f"{n}. {t}" for n, (_i, t) in enumerate(rows, 1))
        hint = ""
    system = (
        "你在整理一段课堂/对话的逐句转写,判断每一句到底是谁说的。原有的说话人标注可能因为远场声纹不准而错乱,"
        "请忽略它,主要根据【对话逻辑】重新判断:谁在提问谁在回答、彼此的称呼(老师/同学/名字)、第一人称视角、"
        "话题与语气的连贯、上下句的衔接。规则:讲解/提问/主导最多的人标为「老师」;其他人按出场先后标为"
        "「同学A」「同学B」…;如果整段其实基本是同一个人在说,就全部标同一个人,不要硬凑出多个。" + hint +
        "\n严格输出 JSON:{\"speakers\": [\"老师\", \"同学A\", ...]},数组长度必须与我给的句子数完全一致、"
        "顺序一一对应,不要多不要少、不要任何解释。")
    user = f"共 {len(rows)} 句,逐句如下:\n{body}"
    try:
        out = ds._chat(system, user, temperature=0.2)
    except Exception:
        return None
    sp = out.get("speakers") if isinstance(out, dict) else None
    if not isinstance(sp, list) or len(sp) != len(rows):
        return None
    res = [None] * len(lines)
    for (i, _t), name in zip(rows, sp):
        res[i] = (str(name).strip() or "老师")
    last = "老师"
    for k in range(len(res)):
        if res[k] is None:
            res[k] = last
        else:
            last = res[k]
    return res


def relabel_session(session_dir, cfg, utt_recs=None):
    """Post-hoc speaker relabeling of a finished recording via DeepSeek (DiarizationLM-style), rewriting
    transcript.jsonl. Robust to the noisy far-field voiceprints that make clustering chaotic. Returns True on
    a successful rewrite. Safe/no-op if DeepSeek isn't configured or the model output doesn't line up."""
    import os as _os
    tp = _os.path.join(session_dir, "transcript.jsonl")
    if not _os.path.exists(tp):
        return False
    lines = []
    with open(tp, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            try:
                lines.append(json.loads(ln))
            except Exception:
                return False
    if len(lines) < 2:
        return False
    ds = DeepSeek(cfg)
    if not ds.ready:
        return False
    vp_groups = None
    if utt_recs:
        try:
            from speaker import cluster_utterances
            vp_groups = cluster_utterances(lines, utt_recs, cfg)
        except Exception:
            vp_groups = None
    labels = _llm_relabel_speakers(ds, lines, vp_groups)
    if not labels:
        return False
    # unique labels -> speaker_id by first appearance (teacher tends to appear first)
    order = {}
    for nm in labels:
        if nm not in order:
            order[nm] = len(order)
    changed = any((lines[i].get("speaker") != labels[i]) for i in range(len(lines)))
    if not changed:
        return False
    for i, L in enumerate(lines):
        L["speaker"] = labels[i]
        L["speaker_id"] = order[labels[i]]
    tmp = tp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for L in lines:
            f.write(json.dumps(L, ensure_ascii=False) + "\n")
    _os.replace(tmp, tp)
    return True
