# -*- coding: utf-8 -*-
"""Timetable screenshot recognition: RapidOCR reads the image → split into columns by x coordinate (leftmost = time/period, the rest = Mon..Sun)
→ hand off to DeepSeek to reconstruct a structured course list. Purely local OCR; images are never sent out.
There is also a cloud channel extract_via_qwen (Alibaba Cloud Bailian Qwen-VL), dispatched by ocr.provider."""
import json
import os

_OCR = None


def _get_ocr():
    global _OCR
    if _OCR is None:
        from rapidocr_onnxruntime import RapidOCR
        _OCR = RapidOCR()
    return _OCR


# Shanghai University bell schedule (period -> time). When the timetable only shows 节次, map to these times.
_SHU_BELLS = (
    "上海大学作息时间(节次→上课时间):第1节 08:00-08:45、第2节 08:55-09:40、第3节 10:00-10:45、"
    "第4节 10:55-11:40、第5节 13:00-13:45、第6节 13:55-14:40、第7节 15:00-15:45、第8节 15:55-16:40、"
    "第9节 18:00-18:45、第10节 18:55-19:40、第11节 20:00-20:45、第12节 20:55-21:40。"
    "课表里若只给了节次(如「1-2节」「3-4」),就按此表换算成 start/end,跨多节取第一节开始到最后一节结束;"
    "若截图里直接写了具体时间,则以截图的时间为准。")


# Weeks: SHU cells print the exact weeks per course (「(1-2节)1-16周」「(3-4节)第1周」「1周,5周,9周,13周」「1-16周(单)」).
# Expand into an explicit list so ranges, single weeks, discrete weeks and odd/even are all handled uniformly.
_WEEK_RULE = (
    "周次:每门课名下面通常写着上课周次(常紧跟在节次后面,如「(1-2节)1-16周」「(3-4节)第1周」「(3-4节)2-16周」"
    "「(3-4节)9-16周」,也可能是离散的「1周,5周,9周,13周」,或带单双周的「1-16周(单)」「1-16周(双)」)。"
    "请把它展开成**具体的周数数组** weeks:"
    "「1-16周」→[1,2,3,…,16];「第1周」→[1];「2-16周」→[2,3,…,16];「1周,5周,9周,13周」→[1,5,9,13];"
    "「1-16周(单)」→[1,3,5,…,15];「1-16周(双)」→[2,4,…,16]。"
    "注意周次和节次是两回事:节次(如1-2节)决定上课时间、周次决定哪几周上,别混。"
    "如果确实没写周次,weeks 就返回空数组 []。")


_SYSTEM = (
    "你是课表识别助手。用户给你一张大学周课表截图的 OCR 结果,已按列分好:第一列是节次编号和上课时间"
    "(如 1 08:00 08:45 表示第1节 08:00-08:45),其余每列依次是周一到周日。同一门课的课名常被 OCR 拆成多行"
    "(课名/@校区/教室号),要按 y 坐标相近合并成一门课。请还原成课程列表,输出 JSON:"
    '{"anchor_monday":"YYYY-MM-DD","courses":[{"name":"课名","day":周几数字1-7,"start":"HH:MM","end":"HH:MM","location":"@校区","room":"教室号","teacher":"任课老师","credits":"学分数字或空","weeks":[周数数组]}]}。'
    "规则:day 周一=1...周日=7;start/end 取该课所在节次对应的时间(跨多节就取第一节开始到最后一节结束);"
    + _SHU_BELLS + _WEEK_RULE +
    "课名去掉换行拼完整(如 高等数 学 A(2) → 高等数学A(2))、明显的 OCR 错字按常见课名纠正(如 博奔论→博弈论);"
    "被截断的课名按最可能的补全;没有教室就留空字符串。"
    "teacher=这门课的任课老师姓名(格子里常有人名,可能多位,用、分隔);没有就留空字符串。"
    "location 填校区(如 宝山主区/延长校区/嘉定校区)、room 填教室号(如 DJ208、A323、F楼实验中心);"
    "格子里写「未排地点」的,room 留空。"
    "credits=学分:格子里常单独一行写着数字(如 5.0、1.0、2.0),那就是这门课的学分,填进 credits;没有就留空字符串。"
    "anchor_monday=截图这一周「周一」那天的真实日期,必须这样定:"
    "①年份取截图里出现的年(如 2026/7/30 或 2026/... 里的 2026);"
    "②月份取表头那行左上角的月份(如「6月」就是 6 月),不要用顶部的当前日期月份;"
    "③日取周一列表头下方的日期数字(周一~周日下方通常是 1 2 3 4 5 6 7 这一排里对应周一的那个)。"
    "例:表头是「6月」、周一列日期数字是 1 → anchor_monday = 该年-06-01。"
    "务必以表头的月份和日期数字为准(即使它和顶部当前日期 2026/7/30 看起来不一致,也以表头为准)。"
    "若跨月(周日数字比周一小)按表头月份推算;实在识别不到就填空字符串。只输出 JSON,不要解释。"
)


_VISION_SYSTEM = (
    "你是课表识别助手。用户直接给你一张大学周课表截图。请识别其中所有课程,输出 JSON:"
    '{"anchor_monday":"YYYY-MM-DD","courses":[{"name":"课名","day":周几数字1-7,"start":"HH:MM","end":"HH:MM","location":"@校区","room":"教室号","teacher":"任课老师","credits":"学分数字或空","weeks":[周数数组]}]}。'
    "规则:day 周一=1...周日=7;start/end 是该课的起止时间(跨多节取第一节开始到最后一节结束);"
    + _SHU_BELLS + _WEEK_RULE +
    "课名补全完整、明显错字纠正;没有教室留空字符串。"
    "teacher=任课老师姓名(可能多位,用、分隔),没有就留空字符串。"
    "location 填校区(如 宝山主区/延长校区/嘉定校区)、room 填教室号(如 DJ208、A323、F楼实验中心);"
    "格子里写「未排地点」的,room 留空。"
    "credits=学分:格子里常单独一行写着数字(如 5.0、1.0、2.0),那就是这门课的学分,填进 credits;没有就留空字符串。"
    "anchor_monday=截图这一周「周一」那天的真实日期:用表头的年份、月份(如「6月」)和各列表头的日期数字确定,"
    "以表头为准(即使和顶部当前日期不一致);识别不到就填空字符串。只输出 JSON,不要解释、不要代码块。"
)


def extract_via_qwen(image_bytes, ocr_cfg):
    """Alibaba Cloud Bailian Qwen-VL vision model: looks at the image directly → structured courses. Images are uploaded to Alibaba Cloud."""
    import base64
    import json as _json
    import urllib.request
    api_key = os.environ.get("DASHSCOPE_API_KEY") or ocr_cfg.get("api_key") or ""
    if not api_key:
        raise ValueError("没配阿里云 DASHSCOPE_API_KEY,无法用云端 OCR")
    model = ocr_cfg.get("model", "qwen-vl-max")
    base = ocr_cfg.get("base_url", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
    b64 = base64.b64encode(image_bytes).decode()
    payload = _json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": _VISION_SYSTEM},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                {"type": "text", "text": "识别这张周课表,按要求输出课程 JSON。"},
            ]},
        ],
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        base + "/chat/completions", data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=ocr_cfg.get("timeout_s", 60)) as resp:
        data = _json.loads(resp.read().decode("utf-8"))
    text = data["choices"][0]["message"]["content"]
    t = text.strip().strip("`")
    if t.lower().startswith("json"):
        t = t[4:]
    out = _json.loads(t)
    return _clean_result(out.get("courses", []), out.get("anchor_monday", "") or "")


def _clean_result(courses, anchor):
    clean = []
    for c in courses:
        if not isinstance(c, dict) or not str(c.get("name", "")).strip():
            continue
        try:
            day = int(c.get("day", 0))
        except (TypeError, ValueError):
            day = 0
        if not (1 <= day <= 7):
            continue
        weeks = []
        for v in (c.get("weeks") or []):
            try:
                iv = int(v)
            except (TypeError, ValueError):
                continue
            if 1 <= iv <= 30 and iv not in weeks:
                weeks.append(iv)
        weeks.sort()
        clean.append({
            "name": str(c.get("name", "")).strip(), "day": day,
            "start": str(c.get("start", "") or ""), "end": str(c.get("end", "") or ""),
            "location": str(c.get("location", "") or ""), "room": str(c.get("room", "") or ""),
            "teacher": str(c.get("teacher", "") or ""),
            "credits": str(c.get("credits", "") or "").strip(), "weeks": weeks,
        })
    return {"courses": clean, "anchor_monday": anchor}


def _structure_from_tokens(toks, ds, width=800):
    """toks: [(cx, cy, text)]. Cluster into columns by x (time column + Mon~Sun) → assemble into text → structure with DeepSeek.
    Used by both local RapidOCR and Alibaba Cloud's traditional OCR; only the token source differs."""
    toks = [t for t in toks if t[2]]
    if not toks:
        return {"courses": [], "note": "没识别到文字"}
    tol = max(40, width * 0.06)
    xs = sorted(t[0] for t in toks)
    cols = []
    for x in xs:
        if not cols or x - cols[-1][-1] > tol:
            cols.append([x])
        else:
            cols[-1].append(x)
    centers = [sum(c) / len(c) for c in cols]

    def col_of(x):
        return min(range(len(centers)), key=lambda i: abs(centers[i] - x))

    grouped = {i: [] for i in range(len(centers))}
    for cx, cy, txt in toks:
        grouped[col_of(cx)].append((cy, txt))
    for i in grouped:
        grouped[i].sort()

    day_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    lines = ["时间/节次列(从上到下): " + " | ".join(t for _, t in grouped[0])]
    for i in range(1, len(centers)):
        day = day_names[i - 1] if i - 1 < len(day_names) else f"第{i}列"
        lines.append(f"{day}列(从上到下): " + " | ".join(f"{t}(y{int(y)})" for y, t in grouped[i]))
    blob = "\n".join(lines)

    out = ds._chat(_SYSTEM, blob)
    courses = out.get("courses", []) if isinstance(out, dict) else []
    anchor = (out.get("anchor_monday", "") if isinstance(out, dict) else "") or ""
    return _clean_result(courses, anchor)


def extract_via_aliyun_ocr(image_bytes, ocr_cfg, ds):
    """Alibaba Cloud's traditional \"Text Recognition OCR - General High-Precision\" (AK/SK): the cloud returns only text + coordinates, then DeepSeek reconstructs the structure.
    Images are uploaded to Alibaba Cloud."""
    import io
    import json as _json
    from alibabacloud_ocr_api20210707.client import Client
    from alibabacloud_ocr_api20210707 import models
    from alibabacloud_tea_openapi import models as open_api_models
    from alibabacloud_tea_util import models as util_models
    ak = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID") or ocr_cfg.get("access_key_id") or ""
    sk = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET") or ocr_cfg.get("access_key_secret") or ""
    if not ak or not sk:
        raise ValueError("没配阿里云 AccessKey(access_key_id / access_key_secret),无法用传统OCR")
    conf = open_api_models.Config(access_key_id=ak, access_key_secret=sk)
    conf.endpoint = ocr_cfg.get("endpoint", "ocr-api.cn-hangzhou.aliyuncs.com")
    client = Client(conf)
    # use "unified OCR" RecognizeAllText, type=Advanced (general high-precision); output_coordinate gets text coordinates for column splitting
    req = models.RecognizeAllTextRequest(
        body=io.BytesIO(image_bytes),
        type=ocr_cfg.get("type", "Advanced"),
        output_coordinate="points")
    resp = client.recognize_all_text_with_options(req, util_models.RuntimeOptions())
    data = resp.body.data   # the SDK has already parsed it into an object
    toks = []
    for sub in (data.sub_images or []):
        bi = getattr(sub, "block_info", None)
        for b in (getattr(bi, "block_details", None) or []):
            word = (b.block_content or "").strip()
            if not word:
                continue
            rect = b.block_rect
            if rect and rect.center_x is not None:
                cx, cy = rect.center_x, rect.center_y
            elif b.block_points:
                pts = b.block_points
                cx = sum(p.x for p in pts) / len(pts)
                cy = sum(p.y for p in pts) / len(pts)
            else:
                continue
            toks.append((cx, cy, word))
    return _structure_from_tokens(toks, ds, width=(data.width or 800))


def extract_timetable(image_bytes, ds, cfg=None):
    """Dispatch by configuration:
      ocr.provider='aliyun'     → cloud Qwen-VL vision model (looks at the image directly)
      ocr.provider='aliyun_ocr' → cloud traditional OCR (high-precision text recognition) + DeepSeek structuring
      other/default             → local RapidOCR + DeepSeek
    Returns {'courses':[...], 'anchor_monday':...}."""
    ocr_cfg = ((cfg or {}).get("ocr") or {})
    provider = (ocr_cfg.get("provider") or "local").lower()
    if provider == "aliyun":
        return extract_via_qwen(image_bytes, ocr_cfg.get("aliyun") or {})
    if provider == "aliyun_ocr":
        return extract_via_aliyun_ocr(image_bytes, ocr_cfg.get("aliyun_ocr") or {}, ds)
    # ---- default: local RapidOCR + DeepSeek ----
    import numpy as np
    import cv2
    img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("图片解码失败,请换一张 png/jpg")
    res, _ = _get_ocr()(img)
    if not res:
        return {"courses": [], "note": "没识别到文字"}
    toks = [(sum(p[0] for p in box) / 4, sum(p[1] for p in box) / 4, txt.strip())
            for box, txt, _conf in res if txt.strip()]
    return _structure_from_tokens(toks, ds, width=img.shape[1])
