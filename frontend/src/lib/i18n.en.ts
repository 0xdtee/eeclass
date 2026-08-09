/**
 * Simplified-Chinese -> English UI dictionary (keys are the exact source strings passed to t()).
 * Grows as more screens are converted. A missing key falls back to the Chinese source, so partial
 * coverage never breaks the UI. Traditional Chinese is generated automatically (OpenCC), not listed here.
 */
export const EN: Record<string, string> = {
  // ---- common / navigation ----
  '返回': 'Back',
  '设置': 'Settings',
  '用户': 'User',
  '教师': 'Teacher',
  '学生': 'Student',
  '保存': 'Save',
  '取消': 'Cancel',
  '删除': 'Delete',
  '确认删除': 'Confirm delete',
  '编辑': 'Edit',
  '加载中…': 'Loading…',

  // ---- settings: categories ----
  'AI 处理': 'AI processing',
  '录音': 'Recording',
  '账户': 'Account',

  // ---- settings: AI toggles ----
  '选择录音时默认开启哪些 AI 处理(每次开录音自动带上)。': 'Choose which AI processing is on by default when recording (applied automatically each time).',
  '✨ AI 实时纠错': '✨ Real-time AI correction',
  '出字后让 DeepSeek 异步改同音错字(如 影射→映射);选「方言」时改为把方言直出的文字润色成规范普通话。消耗少量 API 额度。':
    'After text appears, DeepSeek asynchronously fixes homophone typos (e.g. 影射→映射); with the Dialect model it instead polishes the raw dialect output into standard Mandarin. Uses a little API quota.',
  '🧩 AI 智能分句': '🧩 AI smart segmentation',
  '让 DeepSeek 按语意把停顿切碎的句子合并成完整句再断句(整句模式生效)。':
    'Let DeepSeek merge pause-fragmented sentences into complete ones by meaning (whole-sentence mode only).',
  '🌐 英文自动翻译': '🌐 Auto-translate English',
  '识别到英文句(或英语课)时,在该句下面自动加一行中文字幕。消耗少量 API 额度。':
    'When an English sentence (or an English class) is detected, add a Chinese caption line below it. Uses a little API quota.',
  '📝 结束录制自动生成概要': '📝 Auto-generate summary when recording ends',
  '停止录制后自动整理这节课的 AI 概要;关掉则需手动点生成。':
    'Automatically compile the AI summary for the class after recording stops; if off, generate it manually.',

  // ---- settings: recording params ----
  '录音的默认参数,开录音时自动套用。': 'Default recording parameters, applied automatically when you start.',
  '识别模型': 'Recognition model',
  '普通话/英语': 'Mandarin/English',
  '方言': 'Dialect',
  '流式': 'Streaming',
  '上海话(本地)': 'Shanghainese (local)',
  '拾音灵敏度': 'Pickup sensitivity',
  '老师声音小或坐得远就调高。': 'Turn up if the teacher is quiet or far away.',
  '标准': 'Standard',
  '灵敏': 'Sensitive',
  '最灵敏': 'Most sensitive',
  '默认音源': 'Default audio source',
  '系统声音用于网课(仅电脑 Chrome/Edge)。': 'System audio is for online classes (desktop Chrome/Edge only).',
  '自动': 'Auto',
  '麦克风': 'Microphone',
  '系统声音': 'System audio',

  // ---- settings: auto-tagging ----
  '导入课程时自动打标签': 'Auto-tag courses on import',
  '课表截图识别课程、加进日历后,自动给这些课打上标签。':
    'After a timetable screenshot is recognized and added to the calendar, tag those courses automatically.',
  '相似的归到已有标签': 'Group similar ones under an existing tag',
  '导入的课程名和已有标签相近时,归到那个标签,不重复建。':
    'When an imported course name is close to an existing tag, reuse that tag instead of creating a duplicate.',
  '没有相似的就新建标签': 'Create a new tag when none is similar',
  '导入的课程没有相近标签时,按课程名自动建一个新标签。':
    'When an imported course has no similar tag, create a new one from the course name.',

  // ---- settings: account ----
  '服务地址:': 'Server: ',
  '退出登录': 'Log out',
  '恢复默认设置': 'Restore default settings',

  // ---- settings: language ----
  '界面语言': 'Language',
  '切换后整个界面会立即换成该语言。': 'The whole interface switches to this language immediately.',
};
