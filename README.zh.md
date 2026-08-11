# eeclass — 课堂实时字幕与笔记

[English](README.md) | **中文**

> **把一节课的现场讲授,实时变成一份干净、结构化、可搜索、可复习的笔记。**

eeclass 是一套课堂转写与 AI 笔记系统。老师在台上讲,它实时出字幕、分辨说话人、标记重点;课后再用 AI 生成摘要、考点、模拟卷,帮你复习。语音识别、说话人区分、声纹用 sherpa-onnx / 3D-Speaker 在 CPU 上完成;纠错、摘要等 AI 功能可选接入 DeepSeek。

面向中文大学课堂设计,但识别本身支持多语种(中 / 英 / 日 / 韩 / 粤)。

## 界面预览

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="900" alt="控制台 —— 学期总览、课程日历与快捷入口">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/live.png" alt="实时转写"><br><sub><b>实时转写</b> —— 说话人区分、英文行下自动挂中文字幕、笔记并排。</sub></td>
    <td width="50%"><img src="docs/screenshots/summary.png" alt="AI 摘要"><br><sub><b>AI 摘要</b> —— 每节课摘要、重点知识点、一键纠正同音听错。</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/schedule.png" alt="课程日历"><br><sub><b>课程日历</b> —— 课表导入,按课程配色。</sub></td>
    <td width="50%"><img src="docs/screenshots/settings.png" alt="设置"><br><sub><b>设置</b> —— 实时纠错、智能分句、自动翻译一键开关。</sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/syllabus.png" width="900" alt="官方教学大纲库"><br>
  <sub><b>官方教学大纲库</b> —— 在应用内直接浏览教育部与各高校发布的课程大纲(PDF)。</sub>
</p>

---

## 为谁而做

- **大学生** —— 边听边记跟不上、总漏内容;想要一份能搜索、能复习、能出考点的完整课堂记录。
- **老师** —— 想给自己的讲课留一份逐字记录,并自动生成每节课摘要、跨课的课程总结。
- **听障 / 非母语学生** —— 需要实时字幕,或英文授课时自动挂上中文翻译。

## 能解决什么问题

- **记笔记跟不上、漏重点** —— 全程自动转写并标出老师强调的重点、定义、公式。
- **课后复习没抓手** —— 一键生成每节课摘要、整门课的"大总结"、考点预测、模拟试卷、闪卡自测。
- **语音转写常同音听错、碎句难读** —— AI 实时纠同音错字 + 智能分句,把零碎口语整理成通顺句子(纠错/分句都以"绝不丢字"为前提)。
- **多节课内容分散、找不到** —— 跨所有课程全文搜索("老师讲过 X 在哪节课")。

## 典型使用场景

1. **上课**:iPad / 电脑带进教室,点开始 → 实时出字幕、区分老师/同学、标重点、拍板书(按时间轴对齐)。
2. **课后**:看这节课摘要;或进课程详情做整门课的**大总结 / 考点推测 / 模拟试卷**;用闪卡自测;对整节课**追问**提问。
3. **复习/找料**:全文搜索定位到具体某句;导出 PDF;英文课回看自动挂好的中文字幕。
4. **多端**:课堂用 **iPad 原生 App** 录,手机 / 电脑上用**网页版**复习 —— 同一套后端、同一份数据。

## 亮点

- ⚡ **纯 CPU 实时** —— ASR、说话人、声纹都在 CPU 上跑(sherpa-onnx SenseVoice,RTF≈0.05),不需要 GPU,一台普通机器就能带。
- 🧬 **声纹库会"认人"** —— 给某人起一次名字,以后录到同一个声音自动认出;同一个人只存一份,改名会**回溯更新过去所有课**。
- 🧠 **课程级 AI** —— 不只单节摘要,还能把一整门课的多节课**聚合成大总结**,并预测考点(带占比饼图)、生成模拟卷。
- 📱 **多端一套** —— 网页版 + iPad 原生 App(Capacitor 打包),同一份 `mobile/` 源码。
- 🌏 **多语种识别 + 实时翻译** —— 识别中文(含 16 种方言)、英、法、德、意、西、俄、日、韩;可在 9 种语言间任意方向加一行翻译字幕,用**「原文 ⇄ 译文」下拉**选择(识别走持续云端流,翻译走大模型)。
- 🏠 **开源(MIT)、自托管** —— 一台普通机器 + 局域网即可跑起来。
- 📖 **内置动态说明书** —— 每个功能配 CSS 动画演示 + 操作步骤,上手零门槛。

## 功能

- **实时转写** —— 带标点的流式字幕,纯 CPU(sherpa-onnx SenseVoice,RTF 约 0.05)。可选云端识别(阿里云)额外提供普通话/英语、16 种中文方言(自动转普通话)、以及持续流式的多语言模型(法/德/意/西/俄/日/韩 + 中/英)。
- **说话人区分 + 声纹库** —— 边听边分辨说话人;起一次名字之后自动认出,去重存储,改名回溯到过去的课。
- **划重点** —— 自动标出老师强调的重点、定义、公式。
- **实时翻译** —— 在每句下方挂一行翻译,9 种语言(中/英/法/德/意/西/俄/日/韩)任意方向,用「原文 ⇄ 译文」下拉选择;默认跟随界面语言。
- **AI 辅助(接 DeepSeek,可选)** —— 同音纠错、智能分句、方言润色成规范普通话、每节课摘要(按界面语言输出)、课程大总结、考点预测、模拟试卷、闪卡/自测、对整节课"追问"问答。
- **拍板书** —— 一键拍下黑板/PPT,按时间轴对齐。
- **账号与权限** —— 真实登录(pbkdf2)、严格的按账号数据隔离、声纹库仅管理员可管理、只读分享链接。
- **导出** —— PDF 导出;通过 Office 加载项实时写入 Word(仅 Windows)。
- **课表与教学大纲**、跨课全文搜索、转写可编辑、深浅色主题、拾音灵敏度。
- **可选阿里云 OSS** 做音频与文件的下沉/备份。

## 工作原理

```
网页 / iPad App / Word 加载项 ──WSS──►  Python 后端(aiohttp,HTTPS :5901)
                                        ├─ sherpa-onnx SenseVoice   (ASR,CPU)
                                        ├─ 阿里云 DashScope         (ASR,可选:方言 / 多语言流式)
                                        ├─ silero VAD               (分句)
                                        ├─ 3D-Speaker eres2netv2    (声纹)
                                        ├─ PostgreSQL   (账号/会话/课程元数据)
                                        ├─ records/     (音频/逐句转写/板书,文件存储)
                                        └─ DeepSeek API (文本 + 翻译,可选)
```

- **前端 / 移动端** —— React 19 + Vite + TypeScript + Tailwind(`frontend/` 桌面网页、`mobile/` 移动端);`mobile/` 既构建成网页 `/m`,也用 Capacitor 打包成 iPad 原生 App。
- **后端** —— Python + aiohttp(`backend/service/`)。账号、登录会话、课程元数据存 PostgreSQL;音频、逐句转写、板书图片存 `records/` 文件、被库引用。
- **Word 加载项** —— Office.js 任务窗格(`backend/addin/`,仅 Windows)。

## 环境要求

- Python 3.11+、Node.js 18+、ffmpeg、PostgreSQL 14+
- 约 2 GB 磁盘放语音模型(首次安装时下载)
- AI 功能需要 DeepSeek API key(可选;不填也能转写)

## 快速开始

### macOS

```bash
bash setup-mac.sh          # 装 node/python/ffmpeg + 依赖,下载约 2GB 模型
```

### Windows

```powershell
backend\scripts\install.ps1     # 依赖 + 模型
backend\scripts\start.ps1       # 启动后端
```

### 配置

```bash
cp backend/service/config.example.json backend/service/config.json
```

DeepSeek key 用环境变量提供(推荐,避免写进文件);数据库连接串同理:

```bash
export DEEPSEEK_API_KEY=sk-你的key
export EECLASS_DB_DSN=postgresql:///eeclass   # 本地 peer 认证,无需密码
```

语音识别不需要 key;只有 AI 辅助功能需要。

## 开发运行

两个终端:

```bash
# A —— 后端(识别服务,HTTPS :5901)
cd backend
DEEPSEEK_API_KEY=sk-你的key ./.venv/bin/python service/server.py

# B —— 前端(热更新 :3000)
cd frontend
npm run dev
```

打开 **http://localhost:3000/course**。前端会自动识别开发模式、连本机 5901 后端。

## 构建与部署(单源 / 局域网 / 手机平板)

```bash
cd frontend && BASE_PATH=/app/ npm run build     # 桌面版 → out/
cd mobile   && BASE_PATH=/     npm run build      # 移动版 → out/(供 /m 与 iPad App)
```

后端随后在 **https://localhost:5901/app/course** 提供网页版,在 `/m` 提供移动版。同一 Wi-Fi 下,手机/平板可开 `https://<局域网IP>:5901/app/course`(自签证书,接受警告即可)。开启 `server.require_token` 后需令牌访问。

## 安全

- AI 功能(纠错/摘要等)会把转写**文本**发给 DeepSeek;不用 AI 功能则不产生外部调用。
- 密码存 pbkdf2 哈希;会话基于令牌;令牌闸口有暴力破解锁定。
- **严格按账号隔离** —— 每个账号只看得到自己的课程、课表、声纹库。
- 密钥(`config.json`、`token.txt`、`certs/`、`start-server.sh` 里的环境变量)、全部用户数据(`records/`)、模型都**不进 git**、绝不提交。数据库连接串、API key 放环境变量,别写进文件。

## 项目结构

```
frontend/                  桌面网页前端(React + Vite + TS + Tailwind)
mobile/                    移动端(同栈;构建成网页 /m + Capacitor 打包 iPad App)
backend/
  service/                   后端(Python,aiohttp,sherpa-onnx,PostgreSQL,DeepSeek)
    config.example.json      复制成 config.json 再改
    db.py / migrate_to_db.py PostgreSQL 连接与 JSON→库迁移脚本
    models/                  语音模型(下载,git 忽略)
  addin/                     Word Office.js 任务窗格(Windows)
  records/                   音频/转写/板书等用户数据(git 忽略)
  scripts/                   install.ps1 / start.ps1(Windows)
setup-mac.sh                 macOS 一键开发环境
```

## 模型与许可

语音模型来自 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)(SenseVoice 识别、CT-Transformer 标点)与 [3D-Speaker](https://github.com/modelscope/3D-Speaker)(eres2netv2 声纹),以及 silero VAD。本仓库不转发这些模型 —— 安装脚本会去下载,各自遵循其上游许可。

## 许可

[MIT](LICENSE) © 2026 dtee
