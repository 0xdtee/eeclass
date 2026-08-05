import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMOS, DemoKey, HelpDemoStyles } from './demos';
import BackButton from '@/components/feature/BackButton';

type CatId = 'record' | 'ai' | 'manage' | 'account';

interface Feature {
  icon: string;
  name: string;
  desc: string;
  route: string;
  /** 「前往使用」按钮的文案,默认「前往使用」 */
  cta?: string;
  /** 对应的动态演示组件 key(可选) */
  demo?: DemoKey;
  /** 操作步骤(逐条) */
  steps?: string[];
}

interface Category {
  id: CatId;
  label: string;
  icon: string;
  intro: string;
  features: Feature[];
}

// 说明书内容:只写代码里真实存在的功能,分门别类。
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
          '进入课程页,点红色「开始录制」按钮。',
          '对着讲课说话,字幕会逐句实时出现并带时间戳。',
          '需要时可切换识别模型或暂停;关掉页面转写仍在后台继续。',
          '讲完点「停止」,这节课自动存入历史。',
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
          '停止录制,系统自动基于转写生成本节概要。',
          '要点会逐条列出,概览这节课讲了什么。',
          '需要时在「摘要预览」里点重新生成。',
        ],
      },
      {
        icon: 'ri-book-read-line',
        name: '复习闪卡与自测',
        desc: '用这节课内容生成问答闪卡(带艾宾浩斯遗忘曲线排期)与自测题,点卡片翻面看答案;还能拿本课内容直接追问 DeepSeek。',
        route: '/course',
        cta: '前往复习',
        demo: 'flashcard',
        steps: [
          '在课程页点「生成闪卡 / 自测」。',
          '点卡片翻面查看答案,按记忆情况评分。',
          '系统按艾宾浩斯曲线安排下次复习时间。',
          '有疑问可就本课内容直接追问 AI。',
        ],
      },
      {
        icon: 'ri-file-text-line',
        name: '课程大总结',
        desc: '把同一门课的多节课汇总成一份课程总结,打通各节之间的脉络,一处纵览整门课。到控制台点开某门课即可查看。',
        route: '/',
        cta: '前往控制台',
        demo: 'courseSummary',
        steps: [
          '在控制台点开某一门课程。',
          '系统汇总该课下所有课节的要点。',
          '生成一份贯通全课的大总结,纵览整门课。',
        ],
      },
      {
        icon: 'ri-pie-chart-2-line',
        name: '考点推测',
        desc: 'AI 分析讲课内容推测考点,并用饼图展示各考点所占比重。点某个考点还能回听对应的录音片段,复习更有的放矢。',
        route: '/',
        cta: '前往控制台',
        demo: 'examPie',
        steps: [
          '在课程详情里查看「考点推测」。',
          '饼图按占比展示各考点权重。',
          '点某一考点,回听讲到它的录音片段。',
        ],
      },
      {
        icon: 'ri-file-list-3-line',
        name: '模拟试卷',
        desc: '基于课程内容生成一套模拟试卷,含选择等题型,方便自测练手、检验掌握程度。到控制台点开课程详情查看。',
        route: '/',
        cta: '前往控制台',
        demo: 'quiz',
        steps: [
          '在课程详情里点「生成模拟试卷」。',
          '系统按讲课内容出题。',
          '作答后对照答案,查漏补缺。',
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
          '进入设置页的「AI 处理」区。',
          '逐项打开需要默认启用的处理。',
          '此后每次开录音自动按此配置启用。',
        ],
      },
      {
        icon: 'ri-equalizer-line',
        name: '录音设置',
        desc: '选择识别模型、拾音灵敏度,以及默认音源(麦克风 / 系统声音,上网课时选系统声音)。',
        route: '/settings',
        cta: '前往设置',
        steps: [
          '进入设置页的「录音」区。',
          '选择识别模型与拾音灵敏度。',
          '按场景选默认音源:线下用麦克风,网课用系统声音。',
        ],
      },
      {
        icon: 'ri-user-line',
        name: '账户与退出',
        desc: '查看当前账号与角色信息,并可安全退出登录。',
        route: '/settings',
        cta: '前往设置',
        steps: ['进入设置页查看账号与角色。', '需要时点「退出登录」。'],
      },
    ],
  },
];

export default function HelpPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState<CatId>('record');
  const current = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0];

  return (
    <div className="min-h-screen bg-background-100">
      <HelpDemoStyles />
      {/* 顶栏 */}
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center gap-3 h-14 px-6 max-w-5xl mx-auto">
          <BackButton className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 cursor-pointer">
            <i className="ri-arrow-left-line"></i>
          </BackButton>
          <h1 className="text-sm font-semibold text-foreground-900 flex items-center gap-2">
            <i className="ri-book-2-line"></i>使用说明
          </h1>
          <button
            onClick={() => navigate('/')}
            className="ml-auto text-xs text-foreground-400 hover:text-foreground-600 flex items-center gap-1 cursor-pointer"
          >
            <i className="ri-home-4-line"></i>回到控制台
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <h2 className="text-2xl font-bold text-foreground-900">功能说明书</h2>
          <p className="text-sm text-foreground-400 mt-1">
            每个功能都配有动态演示、详细说明和操作步骤,点「前往使用」直接跳到对应页面。
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-5 items-start">
          {/* 左:分类边栏 */}
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
                <span>{c.label}</span>
                <span
                  className={`ml-auto text-xs ${
                    active === c.id ? 'text-background-50/80' : 'text-foreground-300'
                  }`}
                >
                  {c.features.length}
                </span>
              </button>
            ))}
          </aside>

          {/* 右:该分类下的功能卡片 */}
          <div className="flex-1 min-w-0 w-full">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-foreground-900 flex items-center gap-2">
                <i className={`${current.icon} text-accent-500`}></i>
                {current.label}
              </h3>
              <p className="text-xs text-foreground-400 mt-1">{current.intro}</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {current.features.map((f) => {
                const Demo = f.demo ? DEMOS[f.demo] : null;
                return (
                  <div
                    key={f.name}
                    className="flex flex-col bg-background-50 border border-background-200 rounded-2xl p-4 hover:border-accent-400 transition-colors"
                  >
                    {/* 标题 */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-accent-100 text-accent-600 rounded-xl">
                        <i className={`${f.icon} text-lg`}></i>
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-foreground-900">{f.name}</h4>
                        <p className="text-xs text-foreground-400 leading-relaxed mt-1">{f.desc}</p>
                      </div>
                    </div>

                    {/* 动态演示 */}
                    {Demo && (
                      <div className="mb-3">
                        <Demo />
                      </div>
                    )}

                    {/* 操作步骤 */}
                    {f.steps && f.steps.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-foreground-500 mb-2">
                          <i className="ri-list-ordered-2 text-accent-500"></i>
                          操作步骤
                        </div>
                        <ol className="space-y-1.5">
                          {f.steps.map((s, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="mt-px w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 text-[9px] font-bold">
                                {idx + 1}
                              </span>
                              <span className="text-xs text-foreground-600 leading-relaxed">{s}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* 前往使用 */}
                    <div className="mt-auto pt-3 border-t border-background-100">
                      <button
                        onClick={() => navigate(f.route)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent-600 hover:text-accent-700 cursor-pointer"
                      >
                        {f.cta ?? '前往使用'}
                        <i className="ri-arrow-right-line"></i>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
