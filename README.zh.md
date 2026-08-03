# eeclass — 课堂实时字幕与笔记

[English](README.md) | **中文**

把一节课的现场讲授,实时变成干净、结构化、可搜索的记录 —— 全部在**本机 CPU** 上完成。
语音识别、说话人区分、声纹、划重点都在本地跑,**音频不出设备**;只有可选的文本调用
(纠错/摘要)会发给外部大模型。

面向中文大学课堂设计,但识别本身支持多语种(中/英/日/韩/粤)。

---

## 功能

- **实时转写** —— 带标点的流式字幕,纯 CPU(sherpa-onnx SenseVoice,RTF 约 0.05)。
- **说话人区分 + 声纹库** —— 边听边分辨说话人;给某人起一次名字,之后录到同一个声音会
  自动认出。同一个人只存一份(去重),改名会**回溯到过去的课**一并更新。
- **划重点** —— 自动标出老师强调的重点、定义、公式。
- **AI 辅助(接 DeepSeek,可选)** —— 同音纠错、智能分句、英文→中文字幕、每节课摘要、
  考点预测、闪卡/自测、以及对整节课"追问"问答。
- **拍板书** —— 一键拍下黑板/PPT,按时间轴对齐。
- **账号与隐私** —— 真实登录(pbkdf2)、严格的按账号数据隔离、声纹库仅管理员可管理、
  只读分享链接。
- **导出** —— PDF 导出;通过 Office 加载项实时写入 Word(仅 Windows)。
- **课表与教学大纲**、跨课全文搜索、转写可编辑。
- **可选阿里云 OSS** 做音频与文件的下沉/备份。

## 工作原理

```
浏览器 / Word 加载项 ──WSS──►  Python 后端 (aiohttp, HTTPS :5901)
                                ├─ sherpa-onnx SenseVoice   (识别, CPU)
                                ├─ silero VAD               (断句)
                                ├─ 3D-Speaker eres2netv2    (声纹)
                                └─ DeepSeek API (仅文本, 可选)
```

- **前端** —— React 19 + Vite + TypeScript + Tailwind(`frontend/`),由后端托管在 `/app`。
- **后端** —— Python + aiohttp(`backend/service/`),数据存在 `records/`。
- **Word 加载项** —— Office.js 任务窗格(`backend/addin/`),仅 Windows。

## 环境要求

- Python 3.11+、Node.js 18+、ffmpeg
- 约 2 GB 磁盘放语音模型(首次安装自动下载)
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

用环境变量传 DeepSeek key(推荐,别写进文件):

```bash
export DEEPSEEK_API_KEY=sk-你的key
```

不填 key 也能做语音识别,只有 AI 辅助功能需要它。

## 运行(开发)

开两个终端:

```bash
# A —— 后端(识别服务, HTTPS :5901)
cd backend
DEEPSEEK_API_KEY=sk-你的key ./.venv/bin/python service/server.py

# B —— 前端(热更新 :3000)
cd frontend
npm run dev
```

浏览器打开 **http://localhost:3000/course**。前端会自动识别开发模式,去连
`localhost:5901` 的后端。

## 打包与托管(单端口 / 局域网 / 手机)

```bash
cd frontend
BASE_PATH=/app/ npm run build     # 产物在 out/
```

之后后端会把打包好的网页托管在 **https://localhost:5901/app/course**。同一 WiFi 下手机/
平板可开 `https://<本机内网IP>:5901/app/course`(自签证书,点继续访问)。开启
`server.require_token` 后访问需要令牌。

## 隐私与安全

- **音频、识别、声纹全部在本机 CPU 上完成**,语音不出设备。
- 只有可选的**文本**(用于纠错/摘要的转写片段)会发给 DeepSeek。
- 密码以 pbkdf2 哈希存储;会话基于令牌;令牌门禁带暴力破解锁定。
- **严格按账号隔离** —— 每个账号只能看到自己的课、课程、课表和声纹库。
- 机密(`config.json`、`token.txt`、`certs/`)、全部用户数据(`records/`)和模型都已
  **被 git 忽略**,不会提交。密钥请放环境变量,不要写进文件。

## 目录结构

```
frontend/                 前端 (React + Vite + TS + Tailwind)
backend/
  service/                   后端 (Python, aiohttp, sherpa-onnx, DeepSeek)
    config.example.json      复制成 config.json 再改
    models/                  语音模型 (下载获得, 已 git 忽略)
  addin/                     Word Office.js 任务窗格 (Windows)
  records/                   用户数据 (已 git 忽略)
  scripts/                   install.ps1 / start.ps1 (Windows)
setup-mac.sh                 macOS 一键搭环境
```

## 模型与许可

语音模型来自 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 发布页(SenseVoice 识别、
CT-Transformer 标点)和 [3D-Speaker](https://github.com/modelscope/3D-Speaker)
(eres2netv2 声纹),外加 silero VAD。本仓库不重分发这些模型 —— 由安装脚本下载,各自遵循
其上游许可证。

## 许可证

[MIT](LICENSE) © 2026 dtee@shu.edu.cn
