import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEMOS, DemoKey, HelpDemoStyles } from './demos';
import BackButton from '@/components/feature/BackButton';
import { startGuide } from '@/hooks/useGuide';
import { useT } from '@/lib/i18n';

type CatId = 'record' | 'ai' | 'meeting' | 'manage' | 'account' | 'faq';

// Q&A entries for the FAQ tab. Answers are short lines (rendered as paragraphs); an optional route
// adds a "go there" button. Kept grounded to features that actually exist above.
interface Faq {
  q: string;
  a: string[];
  route?: string;
  cta?: string;
}

const FAQS: Faq[] = [
  {
    q: '怎么设置每次录音默认开启哪些功能?',
    a: [
      '到「设置 → AI 处理默认项」,把想默认启用的开关逐个打开:实时纠错、智能分句、英文翻译、结束自动生成概要。',
      '设好之后,每次开录音都会自动按这套配置启用,不用每次手动勾选。',
    ],
    route: '/settings',
    cta: '前往设置',
  },
  {
    q: '上网课 / 线上会议,怎么录到电脑里播放的声音?',
    a: [
      '到「设置 → 录音 → 默认音源」选「系统声音」(线下当面上课才用麦克风)。',
      'macOS 上开始录音时,按提示分享「浏览器标签页」并勾选「分享标签页声音」,即可采集到网课/会议的声音。',
    ],
    route: '/settings',
    cta: '录音设置',
  },
  {
    q: '怎么切换识别模型、识别方言或多语言?',
    a: [
      '到「设置 → 录音 → 识别模型」里切换。',
      '默认 SenseVoice 纯本机识别;需要方言(粤/吴/闽/川等,自动转普通话)或法德意西俄日韩等多语言时,选对应的云端模型。',
    ],
    route: '/settings',
    cta: '录音设置',
  },
  {
    q: '多个人同时说话,识别不出来怎么办?',
    a: [
      '在录音栏打开「多人分离(实验)」开关。系统会用 GPU 把重叠的话分成两条字幕,分别识别、各自归属说话人。',
      '仍然使用你选的识别模型;分离服务不可用时会自动回退到普通识别。',
    ],
  },
  {
    q: '老是听错专业术语(如把「格林公式」听成「格林公司」)怎么办?',
    a: [
      '① 打开「AI 实时纠错」,让 DeepSeek 在后台把同音错字改回来。',
      '② 录音前在「参考资料」里勾选本节相关学科,作为纠错的上下文,术语更准。',
      '③ 课后在 AI 摘要页用「一键替换」,把某个听错的词一次改到全文并记住,以后自动纠正。',
    ],
  },
  {
    q: '怎么把「说话人1」改成真实姓名?',
    a: [
      '录制结束后,点某个说话人给他改名(如「王老师」)。',
      '系统会记住他的声纹,下次这位老师讲课自动认出、自动署名;同一个人只存一份,改名会回溯更新过去所有课。',
    ],
  },
  {
    q: '录音中不小心关了页面 / 断网了,内容会丢吗?',
    a: [
      '不会。识别在服务器后台继续进行,回到页面时转写还在。',
      '注意:AI 概要是在你点「结束录制 → 确认结束」之后才生成的,所以录完记得正常点结束。',
    ],
  },
  {
    q: '怎么把一节课导出或分享给别人?',
    a: [
      '导出:到「历史课程」打开某节课,导出为 Word 或 PDF。',
      '分享:在该节课点「共享」生成只读链接发给别人,对方无需登录即可查看,链接可随时撤销。',
    ],
    route: '/course',
    cta: '查看历史',
  },
  {
    q: '摘要、考点、模拟卷、复习闪卡分别在哪生成?',
    a: [
      '单节课的 AI 概要:结束录制后自动生成,也可在「摘要预览」手动重新生成。',
      '课程大总结 / 考点推测(带饼图)/ 模拟试卷:到「控制台 → 点课程总数卡片 → 选课程」,进课程详情各标签页生成。',
      '复习闪卡与自测题:在录音页的「复习」标签页生成。',
    ],
  },
  {
    q: '我的音频和数据安全吗?会上传吗?',
    a: [
      '语音识别、说话人区分都在本机完成,音频不上传。',
      '只有用到 AI 功能(纠错 / 摘要等)时,才会把转写的文字发给 DeepSeek;不用 AI 就没有任何外部调用。',
      '每个账号严格隔离,你只看得到自己的课程、课表与声纹库。',
    ],
  },
  {
    q: '手机 / iPad 上能用吗?',
    a: [
      '能。手机和电脑浏览器都能打开网页版复习。',
      'iPad 上还有原生 App:课堂用 iPad 录音,手机 / 电脑上复习,同一套后端、同一份数据。',
    ],
  },
  {
    q: '怎么注销账号?',
    a: [
      '到「设置 → 账户」里注销。',
      '注销后 3 天内,该邮箱暂时不能重新注册。',
    ],
    route: '/settings',
    cta: '前往设置',
  },
];

interface Feature {
  icon: string;
  name: string;
  desc: string;
  route: string;
  /** Label for the 「前往使用」 button, defaults to 「前往使用」 */
  cta?: string;
  /** Key of the corresponding animated-demo component (optional) */
  demo?: DemoKey;
  /** Steps to follow (one by one) */
  steps?: string[];
  /** During step-by-step guidance, the real-element selector each arrow points to (aligned with steps; centered hint if absent) */
  targets?: string[];
}

interface Category {
  id: CatId;
  label: string;
  icon: string;
  intro: string;
  features: Feature[];
}

// Manual content: only features that actually exist in the code, organized by category.
const CATEGORIES: Category[] = [
  {
    id: 'record',
    label: '录音与转写',
    icon: 'ri-mic-line',
    intro: '把课堂声音实时变成文字。录音、识别、说话人区分都在本机运行,不上传任何音频。',
    features: [
      {
        icon: 'ri-mic-2-line',
        name: '实时录音转写',
        desc: '边讲边出字幕,可选 SenseVoice / Paraformer / 流式识别模型。识别在本机完成,录制中即使关掉页面,转写也照常进行,回来还在。',
        route: '/course',
        cta: '开始录制',
        demo: 'record',
        steps: [
          '请先在「课程名称」输入框中修改本节课的名称。',
          '点「开始录音」按钮开始(启动时会显示「正在启动…」)。',
          '录制中听到关键内容,点「标记重点」把刚说的那句标黄。',
          '需要时点「拍板书」拍下当前黑板/PPT,自动对齐到当前时间点。',
          '讲完点「结束录制」,再点弹出的「确认结束」,自动生成 AI 概要并存入历史。',
        ],
        targets: [
          '[data-guide="rec-name"]',
          '[data-guide="rec-start"]',
          '[data-guide="rec-mark"]',
          '[data-guide="rec-shoot"]',
          '[data-guide="rec-stop"]',
        ],
      },
      {
        icon: 'ri-user-voice-line',
        name: '说话人区分与声纹',
        desc: '自动按声音区分不同说话人并统计发言时长。录后可给说话人改名,系统会记住其声纹,下次上课自动认出同一个人。',
        route: '/course',
        demo: 'speaker',
        steps: [
          '正常录制即可,系统自动为每句标注说话人(如「说话人1」)。',
          '录制结束后,点某个说话人给他改名(如「王老师」)。',
          '改名后系统记住声纹,下次这位老师讲课自动认出。',
          '在统计里查看各说话人的发言时长占比。',
        ],
        targets: ['[data-guide="rec-start"]', '', '', ''],
      },
      {
        icon: 'ri-mark-pen-line',
        name: '标记重点',
        desc: '录制中一键把刚说过的那句标为重点;历史记录里也能逐句标黄。导出 Word 时保留标黄配色,复习一眼看到关键句。',
        route: '/course',
        demo: 'mark',
        steps: [
          '录制中听到关键内容,点「标记重点」把刚说的这句标黄。',
          '也可在历史转写里,点任意一句手动标黄或取消。',
          '导出 Word 时标黄配色一并保留。',
        ],
        targets: ['[data-guide="rec-mark"]', '', ''],
      },
      {
        icon: 'ri-camera-line',
        name: '拍板书',
        desc: '录制中随手拍下当前板书 / PPT,截图与转写的时间点一一对应保存。复习时对照文字与画面一起看,不漏黑板上的推导。',
        route: '/course',
        demo: 'photo',
        steps: [
          '录制中看到重要板书,点「拍板书」按钮拍下当前画面。',
          '截图自动关联到当前转写时间点。',
          '复习时在该时间点旁即可看到对应板书截图。',
        ],
        targets: ['[data-guide="rec-shoot"]', '', ''],
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI 智能功能',
    icon: 'ri-sparkling-2-line',
    intro: '借助 DeepSeek 让字幕更准、更好读,并把一节课自动整理成可复习的知识。',
    features: [
      {
        icon: 'ri-eraser-line',
        name: 'AI 实时纠错',
        desc: '出字后异步纠正同音错字(如 格林公司 → 格林公式、影射 → 映射),字幕更贴近老师原意。不打断实时字幕,校对在后台默默进行。可在设置里默认开启。',
        route: '/course',
        demo: 'correction',
        steps: [
          '录制中开启「AI 实时纠错」(或在设置里设为默认)。',
          '字幕先按原样快速出现,保证不卡顿。',
          'DeepSeek 在后台校对,几秒后把同音错字替换为正确写法。',
        ],
        targets: ['[data-guide="ai-correct"]', '', ''],
      },
      {
        icon: 'ri-scissors-cut-line',
        name: 'AI 智能分句',
        desc: '老师停顿会把一句话切成很多碎片,智能分句按语义把碎片合并,再补上标点重新断句,整段读起来通顺连贯。',
        route: '/course',
        demo: 'segment',
        steps: [
          '开启「AI 智能分句」。',
          '系统把因停顿切碎的 ASR 片段按语义聚合。',
          '合并后自动补标点、重新断句,输出通顺的完整句。',
        ],
        targets: ['[data-guide="ai-seg"]', '', ''],
      },
      {
        icon: 'ri-translate-2',
        name: '英文自动翻译',
        desc: '识别到英文句(或上英语课)时,在该句下面自动补一行中文字幕,中英对照,听不懂的地方立刻看懂。',
        route: '/course',
        demo: 'translate',
        steps: [
          '开启「英文自动翻译」。',
          '系统检测到英文句子时自动翻译。',
          '中文译文淡入显示在英文原句下方,中英对照。',
        ],
      },
      {
        icon: 'ri-magic-line',
        name: 'AI 课程概要',
        desc: '停止录制后自动整理这节课的 AI 摘要与要点,要点逐条生成;也可在「摘要预览」里随时手动重新生成。',
        route: '/course',
        demo: 'summary',
        steps: [
          '点「确认结束」结束录制后,系统自动基于转写生成本节 AI 概要。',
          '在「AI 摘要预览」里查看摘要与逐条要点。',
          '想重新生成,到「实时转写」标签页点「生成AI摘要」按钮。',
        ],
        targets: ['[data-guide="rec-stop"]', '[data-guide="tab-summary"]', '[data-guide="gen-summary"]'],
      },
      {
        icon: 'ri-book-read-line',
        name: '复习闪卡与自测',
        desc: '用这节课内容生成问答闪卡(带艾宾浩斯遗忘曲线排期)与自测题,点卡片翻面看答案;还能拿本课内容直接追问 DeepSeek。',
        route: '/course',
        cta: '前往复习',
        demo: 'flashcard',
        steps: [
          '切到「复习」标签页,点「由 DeepSeek 将本节课生成复习闪卡」(自测题则点「由 DeepSeek 生成一套本节课的自测题」)。',
          '点卡片翻面查看答案,按记忆情况评分。',
          '系统按艾宾浩斯曲线安排下次复习时间。',
          '有疑问可就本课内容直接追问 AI。',
        ],
        targets: ['[data-guide="tab-review"]', '[data-guide="make-flashcard"]', '', ''],
      },
      {
        icon: 'ri-file-text-line',
        name: '课程大总结',
        desc: '把同一门课的多节课汇总成一份课程总结,打通各节之间的脉络,一处纵览整门课。到控制台点开某门课即可查看。',
        route: '/',
        cta: '前往控制台',
        demo: 'courseSummary',
        steps: [
          '点控制台上的「课程总数」卡片,打开课程列表。',
          '在弹出的列表中,点击要汇总的课程。',
          '进入课程详情,默认就在「课程总结」页。',
          '点右上角「重新生成」,让 AI 汇总这门课所有课节的大总结。',
        ],
        targets: ['[data-guide="dash-courses"]', '[data-guide="course-pick"]', '[data-guide="cd-tab-summary"]', '[data-guide="cd-regen"]'],
      },
      {
        icon: 'ri-pie-chart-2-line',
        name: '考点推测',
        desc: 'AI 分析讲课内容推测考点,并用饼图展示各考点所占比重。点某个考点还能回听对应的录音片段,复习更有的放矢。',
        route: '/',
        cta: '前往控制台',
        demo: 'examPie',
        steps: [
          '点控制台上的「课程总数」卡片,打开课程列表。',
          '在弹出的列表中,点击要分析的课程。',
          '进入课程详情后,点「考点推测」标签页。',
          '查看饼图中各考点占比;点击某个考点还可回听对应的录音片段。',
        ],
        targets: ['[data-guide="dash-courses"]', '[data-guide="course-pick"]', '[data-guide="cd-tab-exam"]', ''],
      },
      {
        icon: 'ri-file-list-3-line',
        name: '模拟试卷',
        desc: '基于课程内容生成一套模拟试卷,含选择等题型,方便自测练手、检验掌握程度。到控制台点开课程详情查看。',
        route: '/',
        cta: '前往控制台',
        demo: 'quiz',
        steps: [
          '点控制台上的「课程总数」卡片,打开课程列表。',
          '在弹出的列表里,点那门课。',
          '进入课程详情后,点「模拟试卷」标签页。',
          '点右上角「重新生成」,按讲课内容出一套模拟卷,作答后对照答案。',
        ],
        targets: ['[data-guide="dash-courses"]', '[data-guide="course-pick"]', '[data-guide="cd-tab-mock"]', '[data-guide="cd-regen"]'],
      },
    ],
  },
  {
    id: 'meeting',
    label: '会议翻译',
    icon: 'ri-translate-2',
    intro: '一个人对着话筒说,多种语言实时出字幕,投屏到大屏。结束一键生成会议纪要,还能边放 PPT / 视频边显示字幕。',
    features: [
      {
        icon: 'ri-translate-2',
        name: '多语言实时字幕',
        desc: '最多选 3 种语言(中/英/日/韩/法/德/西/意/俄)。说其中一种,其余语言实时作为字幕出现,分栏一一对应,说哪种哪种就是源语言。',
        route: '/meeting',
        cta: '前往会议翻译',
        demo: 'meetingLive',
        steps: [
          '在「字幕语言」里勾选参会的语言(最多 3 种)。',
          '点右上角「开始」,授权麦克风后开始说话。',
          '说其中一种语言,其余语言实时在各自分栏出现。',
          '面对面开会时把设备放桌子中间,「收音增益」调大些收得更全。',
        ],
      },
      {
        icon: 'ri-slideshow-2-line',
        name: '投屏排版',
        desc: '专为投屏设计:字幕铺满整宽、字号可像 Word 一样缩放、横版堆叠或竖版分栏随意切,一键全屏。顶栏可收起,把画面全留给字幕。',
        route: '/meeting',
        cta: '前往会议翻译',
        demo: 'meetingProjection',
        steps: [
          '用「字号 − / %  / +」把字调到大屏够清楚的大小。',
          '点布局按钮在横版(堆叠)和竖版(分栏)之间切换。',
          '点全屏按钮投到大屏;需要更多空间时点顶栏把手把设置收起。',
        ],
      },
      {
        icon: 'ri-file-list-3-line',
        name: '会议纪要',
        desc: '点「结束」后自动用 AI 整理成结构化纪要:主题、概述、讨论要点、决定事项、待办(含负责人)。可选择语言生成对应语言的纪要,并按所选语言多选导出 PDF。',
        route: '/meeting',
        cta: '前往会议翻译',
        demo: 'meetingMinutes',
        steps: [
          '开完会点「结束」,系统自动生成会议纪要。',
          '在纪要面板选择语言,即可得到对应语言的纪要。',
          '点导出 PDF,勾选要导出的语言(可多选)一次导出。',
        ],
      },
      {
        icon: 'ri-folder-3-line',
        name: '管理文件',
        desc: '每个账号一个文件库,可上传 PPT / 视频 / 图片。双击文件即在字幕上方的框里显示:PPT 像放映一样翻页,视频照常播放,字幕压缩在其上方,还能拉动分隔条调整大小。',
        route: '/meeting',
        cta: '前往会议翻译',
        demo: 'meetingFiles',
        steps: [
          '点「管理文件」打开文件库,点「新增文件」上传 PPT / 视频等。',
          '双击某个文件,让它在字幕上方的框里显示。',
          'PPT 用方向键 / 点击翻页;拖动分隔条调整显示区域大小。',
          '点右上角打叉关闭,恢复整屏字幕。',
        ],
      },
      {
        icon: 'ri-history-line',
        name: '会议历史',
        desc: '每场会议(双语记录 + 纪要)自动存档,右上角「历史记录」随时回看,控制台日历上也能看到。登录后跨设备同步,本机已有记录会自动继承到账号。',
        route: '/meeting',
        cta: '前往会议翻译',
        demo: 'meetingHistory',
        steps: [
          '会议结束后自动存入历史,无需手动保存。',
          '点右上角「历史记录」查看并回看任意一场。',
          '也可在控制台日历上找到对应日期的会议。',
        ],
      },
    ],
  },
  {
    id: 'manage',
    label: '课程与资料管理',
    icon: 'ri-folder-2-line',
    intro: '归档、检索、共享每一节课,并接入官方教学大纲作为参考。',
    features: [
      {
        icon: 'ri-history-line',
        name: '历史课程',
        desc: '查看、搜索过往每一节课的转写与摘要,按关键词秒级检索,支持导出 Word / PDF 归档留存。',
        route: '/course',
        cta: '查看历史',
        demo: 'history',
        steps: [
          '进入历史课程列表。',
          '在搜索框输入关键词,实时过滤匹配的课节。',
          '点开某节课查看完整转写与摘要。',
          '需要时导出为 Word 或 PDF。',
        ],
        targets: ['[data-guide="tab-history"]', '', '', ''],
      },
      {
        icon: 'ri-price-tag-3-line',
        name: '标签管理',
        desc: '给课程打彩色标签、集中管理所有标签,便于按主题(如「期末重点」「易错」)分类与快速检索。',
        route: '/tags',
        cta: '管理标签',
        demo: 'tag',
        steps: [
          '在课程上点「添加标签」,选已有或新建标签。',
          '为标签设置名称与颜色。',
          '在标签管理页集中增删、重命名。',
          '按标签筛选,快速找到同类课程。',
        ],
        targets: ['[data-guide="tags-add"]', '', '', ''],
      },
      {
        icon: 'ri-booklet-line',
        name: '参考资料',
        desc: '按学科浏览官方教学大纲 / 参考 PDF;录音时勾选相关学科,即可作为 AI 纠错的上下文,专业术语识别更准。',
        route: '/reference',
        cta: '打开资料',
        demo: 'reference',
        steps: [
          '打开参考资料,按学科浏览大纲 / PDF。',
          '录音前勾选本节相关的学科。',
          '该资料即作为 AI 纠错上下文,术语更准。',
        ],
      },
      {
        icon: 'ri-share-forward-line',
        name: '共享课程',
        desc: '为某节课生成只读分享链接发给他人,对方无需登录即可查看转写与摘要,链接可随时撤销,安全可控。',
        route: '/course',
        demo: 'share',
        steps: [
          '在某节课点「共享」,生成只读链接。',
          '把链接发给同学 / 老师。',
          '对方无需登录即可查看。',
          '不想共享时,一键撤销链接失效。',
        ],
      },
    ],
  },
  {
    id: 'account',
    label: '设置与账号',
    icon: 'ri-user-settings-line',
    intro: '按你的习惯预设录音与 AI 行为,并管理账号。',
    features: [
      {
        icon: 'ri-sparkling-line',
        name: 'AI 处理默认项',
        desc: '设置每次开录音默认开启哪些 AI 处理:实时纠错、智能分句、英文翻译、结束自动生成概要,一次设好每次省心。',
        route: '/settings',
        cta: '前往设置',
        demo: 'toggle',
        steps: [
          '在这些开关里,逐项打开要默认启用的处理:实时纠错、智能分句、英文翻译、结束自动生成概要。',
          '此后每次开录音都会自动按这个配置启用。',
        ],
        targets: ['[data-guide="set-ai"]', ''],
      },
      {
        icon: 'ri-equalizer-line',
        name: '录音设置',
        desc: '选择识别模型、拾音灵敏度,以及默认音源(麦克风 / 系统声音,上网课时选系统声音)。',
        route: '/settings',
        cta: '前往设置',
        steps: [
          '点左侧「录音」分类。',
          '选择「识别模型」与「拾音灵敏度」。',
          '选「默认音源」:线下用麦克风,网课用系统声音。',
        ],
        targets: ['[data-guide="set-cat-record"]', '[data-guide="set-record"]', '[data-guide="set-record"]'],
      },
      {
        icon: 'ri-user-line',
        name: '账户与退出',
        desc: '查看当前账号与角色信息,并可安全退出登录。',
        route: '/settings',
        cta: '前往设置',
        steps: ['点左侧「账户」分类,查看当前账号与角色。', '需要退出时,点「退出登录」按钮。'],
        targets: ['[data-guide="set-cat-account"]', '[data-guide="set-logout"]'],
      },
    ],
  },
];

export default function HelpPage() {
  const t = useT();
  const navigate = useNavigate();
  // Store the current category in the URL (?cat=), so returning from a feature page restores the category you were viewing instead of resetting to default
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('cat') || '';
  const active: CatId = (['record', 'ai', 'meeting', 'manage', 'account', 'faq'].includes(raw) ? raw : 'record') as CatId;
  const setActive = (id: CatId) => setSp({ cat: id }, { replace: true });
  const current = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0];
  // Which FAQ item is expanded (index; -1 = all collapsed)
  const [openFaq, setOpenFaq] = useState<number>(0);

  return (
    <div className="min-h-screen bg-background-100">
      <HelpDemoStyles />
      {/* Top bar */}
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center gap-3 h-14 px-6 max-w-7xl mx-auto">
          <BackButton className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 cursor-pointer">
            <i className="ri-arrow-left-line"></i>
          </BackButton>
          <h1 className="text-sm font-semibold text-foreground-900 flex items-center gap-2">
            <i className="ri-book-2-line"></i>{t('使用说明')}
          </h1>
          <button
            onClick={() => navigate('/')}
            className="ml-auto text-xs text-foreground-400 hover:text-foreground-600 flex items-center gap-1 cursor-pointer"
          >
            <i className="ri-home-4-line"></i>{t('回到控制台')}
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <h2 className="text-2xl font-bold text-foreground-900">{t('功能说明书')}</h2>
          <p className="text-sm text-foreground-400 mt-1">
            {t('每个功能都配有动态演示、详细说明和操作步骤,点「前往使用」直接跳到对应页面。')}
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-5 items-start">
          {/* Left: category sidebar */}
          <aside className="w-full md:w-56 flex-shrink-0 flex md:flex-col gap-1.5 overflow-x-auto md:sticky md:top-20 no-scrollbar">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm whitespace-nowrap cursor-pointer transition-colors flex-shrink-0 md:w-full ${
                  active === c.id
                    ? 'bg-accent-500 text-background-50 font-semibold shadow-sm'
                    : 'text-foreground-600 hover:bg-background-50'
                }`}
              >
                <i className={`${c.icon} text-base`}></i>
                <span>{t(c.label)}</span>
                <span
                  className={`ml-auto text-xs ${
                    active === c.id ? 'text-background-50/80' : 'text-foreground-300'
                  }`}
                >
                  {c.features.length}
                </span>
              </button>
            ))}
            {/* FAQ tab (Q&A accordion, not feature cards) */}
            <button
              onClick={() => setActive('faq')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm whitespace-nowrap cursor-pointer transition-colors flex-shrink-0 md:w-full ${
                active === 'faq'
                  ? 'bg-accent-500 text-background-50 font-semibold shadow-sm'
                  : 'text-foreground-600 hover:bg-background-50'
              }`}
            >
              <i className="ri-question-answer-line text-base"></i>
              <span>{t('常见问题')}</span>
              <span className={`ml-auto text-xs ${active === 'faq' ? 'text-background-50/80' : 'text-foreground-300'}`}>
                {FAQS.length}
              </span>
            </button>
          </aside>

          {/* Right: FAQ accordion, or feature cards under this category */}
          <div className="flex-1 min-w-0 w-full">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-foreground-900 flex items-center gap-2">
                <i className={`${active === 'faq' ? 'ri-question-answer-line' : current.icon} text-accent-500`}></i>
                {active === 'faq' ? t('常见问题') : t(current.label)}
              </h3>
              <p className="text-xs text-foreground-400 mt-1">
                {active === 'faq' ? t('常见操作与疑问的快速解答;点问题展开答案。') : t(current.intro)}
              </p>
            </div>

            {active === 'faq' ? (
              <div className="flex flex-col gap-2.5">
                {FAQS.map((f, i) => {
                  const open = openFaq === i;
                  return (
                    <div
                      key={i}
                      className={`bg-background-50 border rounded-2xl overflow-hidden transition-colors ${
                        open ? 'border-accent-400' : 'border-background-200'
                      }`}
                    >
                      <button
                        onClick={() => setOpenFaq(open ? -1 : i)}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-background-100/50"
                      >
                        <span className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-lg bg-accent-100 text-accent-600 text-xs font-bold">
                          Q
                        </span>
                        <span className="flex-1 min-w-0 text-sm font-semibold text-foreground-900">{t(f.q)}</span>
                        <i
                          className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${
                            open ? 'rotate-180' : ''
                          }`}
                        ></i>
                      </button>
                      {open && (
                        <div className="px-4 pb-4 pl-[3.25rem]">
                          <div className="space-y-2 border-l-2 border-accent-100 pl-3">
                            {f.a.map((line, j) => (
                              <p key={j} className="text-xs text-foreground-600 leading-relaxed">
                                {t(line)}
                              </p>
                            ))}
                          </div>
                          {f.route && (
                            <button
                              onClick={() => navigate(f.route!)}
                              className="mt-3 ml-3 inline-flex items-center gap-1 text-xs font-semibold text-accent-600 hover:text-accent-700 cursor-pointer"
                            >
                              {t(f.cta ?? '前往使用')}
                              <i className="ri-arrow-right-line"></i>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {current.features.map((f) => {
                const Demo = f.demo ? DEMOS[f.demo] : null;
                return (
                  <div
                    key={f.name}
                    className="flex flex-col bg-background-50 border border-background-200 rounded-2xl p-4 hover:border-accent-400 transition-colors"
                  >
                    {/* Title */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-accent-100 text-accent-600 rounded-xl">
                        <i className={`${f.icon} text-lg`}></i>
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-foreground-900">{t(f.name)}</h4>
                        <p className="text-xs text-foreground-400 leading-relaxed mt-1">{t(f.desc)}</p>
                      </div>
                    </div>

                    {/* Animated demo */}
                    {Demo && (
                      <div className="mb-3">
                        <Demo />
                      </div>
                    )}

                    {/* Steps */}
                    {f.steps && f.steps.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-foreground-500 mb-2">
                          <i className="ri-list-ordered-2 text-accent-500"></i>
                          {t('操作步骤')}
                        </div>
                        <ol className="space-y-1.5">
                          {f.steps.map((s, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="mt-px w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 text-[9px] font-bold">
                                {idx + 1}
                              </span>
                              <span className="text-xs text-foreground-600 leading-relaxed">{t(s)}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Go use it */}
                    <div className="mt-auto pt-3 border-t border-background-100">
                      <button
                        onClick={() => { startGuide(f.name, f.steps, f.targets); navigate(f.route); }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent-600 hover:text-accent-700 cursor-pointer"
                      >
                        {f.cta ? t(f.cta) : t('前往使用')}
                        <i className="ri-arrow-right-line"></i>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
