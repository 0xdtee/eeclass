# -*- coding: utf-8 -*-
"""生成/存储大学课程的标准教学大纲(综合国内主流高校的通用要求),
存到 records/syllabus/*.json,作为课堂/课程整理的参照骨架。大纲内容由 DeepSeek 依其课程知识生成。"""
import os
import re
import json


def generate_syllabus(name, ds):
    sys = (
        f"你是大学课程教学大纲专家。请给出《{name}》这门大学课程的**标准教学大纲**"
        "(综合国内主流高校的通用教学要求,不针对某一所学校)。输出 JSON:"
        '{"course":"课程名","overview":"课程简介(2-3句)","credits_hint":"常见学分/学时,如 通常4-5学分、64-80学时",'
        '"textbooks":["常用教材(书名+主要作者或版本)"],'
        '"chapters":[{"title":"章节名","topics":["知识点..."],"exam_points":["该章常见考点/重点题型..."]}],'
        '"key_formulas":["贯穿全课的核心公式或定理(文科课可留空数组)"]}。'
        "chapters 覆盖这门课一学期的主要内容、按教学顺序排列;每章 topics 3~8 条、exam_points 2~5 条。"
        "只输出 JSON,不要解释。"
    )
    out = ds._chat(sys, f"课程:{name}")
    if isinstance(out, dict):
        out["source"] = "standard"
    return out


def official_syllabus(name, ds):
    """通识/思政类等有全国统一统编教材的课程,依官方教材章节结构生成,标为官方大纲。"""
    sys = (
        f"你是《{name}》这门大学课程的教学专家。这是一门**全国统一、有教育部规定统编教材/教学大纲**的课程"
        "(思政类用马工程重点教材;军事理论用《普通高等学校军事课教学大纲》;大学生心理健康用教育部指导纲要)。"
        "请**严格依据其官方统编教材的章节结构和编排**给出这门课的教学大纲,章节标题要贴合官方教材。输出 JSON:"
        '{"course":"课程名","overview":"课程简介(2-3句)","credits_hint":"官方规定的学分/学时",'
        '"textbooks":["官方统编教材(书名+出版社+最新版本)"],'
        '"chapters":[{"title":"官方教材的章节名","topics":["本章要点..."],"exam_points":["常见考点..."]}],'
        '"key_formulas":[]}。'
        "chapters 按官方教材顺序、覆盖全书;只输出 JSON,不要解释。"
    )
    out = ds._chat(sys, f"课程:{name}")
    if isinstance(out, dict):
        out["source"] = "official"
    return out


# 有全国统一官方大纲/统编教材的课程
OFFICIAL_COURSES = [
    "马克思主义基本原理", "毛泽东思想和中国特色社会主义理论体系概论",
    "习近平新时代中国特色社会主义思想概论", "思想道德与法治", "中国近现代史纲要",
    "形势与政策", "军事理论", "大学生心理健康教育",
]


def syllabus_dir(records_root):
    d = os.path.join(records_root, "syllabus")
    os.makedirs(d, exist_ok=True)
    return d


def syllabus_path(records_root, name):
    safe = re.sub(r'[\\/:*?"<>|]', "_", name)
    return os.path.join(syllabus_dir(records_root), f"{safe}.json")


def load_syllabus(records_root, name):
    p = syllabus_path(records_root, name)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_syllabus(records_root, name, data):
    with open(syllabus_path(records_root, name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# 常见基础课/公共课
BASIC_COURSES = [
    "高等数学", "线性代数", "概率论与数理统计", "大学物理", "大学物理实验",
    "C语言程序设计", "大学计算机基础", "离散数学", "数据结构", "大学化学",
    "大学英语", "大学语文",
    "马克思主义基本原理", "毛泽东思想和中国特色社会主义理论体系概论",
    "习近平新时代中国特色社会主义思想概论", "思想道德与法治", "中国近现代史纲要",
    "形势与政策", "军事理论", "大学生心理健康教育", "工程图学", "理论力学",
]
