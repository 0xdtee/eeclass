# -*- coding: utf-8 -*-
"""课表截图识别:RapidOCR 读图 → 按 x 坐标分列(最左=时间/节次,其余=周一..周日)
→ 交给 DeepSeek 还原成结构化课程列表。纯本地 OCR,不把图片发出去。
另有云端通道 extract_via_qwen(阿里云百炼 Qwen-VL),按 ocr.provider 分流。"""
import json
import os

_OCR = None


def _get_ocr():
    global _OCR
    if _OCR is None:
        from rapidocr_onnxruntime import RapidOCR
        _OCR = RapidOCR()
    return _OCR


_SYSTEM = (
    "你是课表识别助手。用户给你一张大学周课表截图的 OCR 结果,已按列分好:第一列是节次编号和上课时间"
    "(如 1 08:00 08:45 表示第1节 08:00-08:45),其余每列依次是周一到周日。同一门课的课名常被 OCR 拆成多行"
    "(课名/@校区/教室号),要按 y 坐标相近合并成一门课。请还原成课程列表,输出 JSON:"
    '{"anchor_monday":"YYYY-MM-DD","courses":[{"name":"课名","day":周几数字1-7,"start":"HH:MM","end":"HH:MM","location":"@校区","room":"教室号"}]}。'
    "规则:day 周一=1...周日=7;start/end 取该课所在节次对应的时间(跨多节就取第一节开始到最后一节结束);"
    "课名去掉换行拼完整(如 高等数 学 A(2) → 高等数学A(2))、明显的 OCR 错字按常见课名纠正(如 博奔论→博弈论);"
    "被截断的课名按最可能的补全;没有教室就留空字符串。"
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
    '{"anchor_monday":"YYYY-MM-DD","courses":[{"name":"课名","day":周几数字1-7,"start":"HH:MM","end":"HH:MM","location":"@校区","room":"教室号"}]}。'
    "规则:day 周一=1...周日=7;start/end 是该课的起止时间(跨多节取第一节开始到最后一节结束);"
    "课名补全完整、明显错字纠正;没有教室留空字符串。"
    "anchor_monday=截图这一周「周一」那天的真实日期:用表头的年份、月份(如「6月」)和各列表头的日期数字确定,"
    "以表头为准(即使和顶部当前日期不一致);识别不到就填空字符串。只输出 JSON,不要解释、不要代码块。"
)


def extract_via_qwen(image_bytes, ocr_cfg):
    """阿里云百炼 Qwen-VL 视觉大模型:直接看图 → 结构化课程。图片会上传到阿里云。"""
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
        clean.append({
            "name": str(c.get("name", "")).strip(), "day": day,
            "start": str(c.get("start", "") or ""), "end": str(c.get("end", "") or ""),
            "location": str(c.get("location", "") or ""), "room": str(c.get("room", "") or ""),
        })
    return {"courses": clean, "anchor_monday": anchor}


def _structure_from_tokens(toks, ds, width=800):
    """toks: [(cx, cy, text)]。按 x 聚类成列(时间列 + 周一~周日)→ 拼成文本 → DeepSeek 结构化。
    本地 RapidOCR 和 阿里云传统 OCR 都用它,只是 tokens 来源不同。"""
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
    """阿里云传统「文字识别 OCR·通用高精版」(AK/SK):云端只出文字+坐标,再交给 DeepSeek 还原结构。
    图片会上传到阿里云。"""
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
    # 走「OCR统一识别」RecognizeAllText,type=Advanced(通用高精版);output_coordinate 拿文字坐标做分列
    req = models.RecognizeAllTextRequest(
        body=io.BytesIO(image_bytes),
        type=ocr_cfg.get("type", "Advanced"),
        output_coordinate="points")
    resp = client.recognize_all_text_with_options(req, util_models.RuntimeOptions())
    data = resp.body.data   # SDK 已解析成对象
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
    """按配置分流:
      ocr.provider='aliyun'     → 云端 Qwen-VL 视觉大模型(直接看图)
      ocr.provider='aliyun_ocr' → 云端 传统OCR(文字识别高精版)+ DeepSeek 结构化
      其它/默认                  → 本地 RapidOCR + DeepSeek
    返回 {'courses':[...], 'anchor_monday':...}。"""
    ocr_cfg = ((cfg or {}).get("ocr") or {})
    provider = (ocr_cfg.get("provider") or "local").lower()
    if provider == "aliyun":
        return extract_via_qwen(image_bytes, ocr_cfg.get("aliyun") or {})
    if provider == "aliyun_ocr":
        return extract_via_aliyun_ocr(image_bytes, ocr_cfg.get("aliyun_ocr") or {}, ds)
    # ---- 默认:本地 RapidOCR + DeepSeek ----
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
