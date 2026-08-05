import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const features = [
  {
    icon: 'ri-mic-line',
    title: '实时语音转写',
    description: '课堂录音即时转换为文字，支持中英文混合识别，准确率高达98%，不错过任何一个知识点。',
  },
  {
    icon: 'ri-magic-line',
    title: 'AI 智能摘要',
    description: '一键生成课堂重点摘要，自动提取关键概念与核心结论，让复习效率提升 3 倍。',
  },
  {
    icon: 'ri-calendar-check-line',
    title: '课程日历管理',
    description: '年/月/日三级视图自由切换，按日期查看全部课时，颜色区分章节，一目了然。',
  },
  {
    icon: 'ri-share-forward-line',
    title: '师生共享协作',
    description: '教师灵活设置查看与编辑权限，学生可评论互动，构建高效的学习共同体。',
  },
  {
    icon: 'ri-price-tag-3-line',
    title: '章节标签分类',
    description: '按数据结构章节自动归类，绪论到排序七大模块，快速定位目标内容。',
  },
  {
    icon: 'ri-history-line',
    title: '编辑历史追溯',
    description: '每一次修改都有记录，支持版本对比与回滚，确保课堂纪要的准确性与完整性。',
  },
];

const steps = [
  {
    step: '01',
    icon: 'ri-user-add-line',
    title: '创建账户',
    description: '选择教师或学生角色，30 秒完成注册，即刻开启智能课堂管理之旅。',
  },
  {
    step: '02',
    icon: 'ri-mic-line',
    title: '录制课堂',
    description: '上课时开启录音，系统实时转写文字，AI 同步分析重点内容。',
  },
  {
    step: '03',
    icon: 'ri-file-text-line',
    title: '回顾共享',
    description: '课后查看 AI 摘要与完整转写，一键共享给学生，知识永不失传。',
  },
];

const stats = [
  { value: '98%', label: '转写准确率' },
  { value: '17+', label: '课程记录' },
  { value: '3x', label: '复习效率提升' },
  { value: '127+', label: '活跃学生' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background-50">
      {/* Navbar */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-background-50/95 backdrop-blur-md border-b border-background-200'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 flex items-center justify-center bg-accent-500 rounded-lg">
              <i className="ri-book-open-line text-background-50 text-lg"></i>
            </div>
            <span className="text-lg font-bold text-foreground-900">课堂纪要</span>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm text-foreground-500 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap">功能</a>
            <a href="#how-it-works" className="text-sm text-foreground-500 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap">使用流程</a>
            <a href="#cta" className="text-sm text-foreground-500 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap">开始使用</a>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="px-4 py-2 text-sm font-medium text-foreground-700 hover:text-foreground-900 transition-colors cursor-pointer whitespace-nowrap"
            >
              登录
            </button>
            <button
              onClick={() => navigate('/register')}
              className="px-5 py-2 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              免费注册
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative min-h-[620px] flex items-center overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://readdy.ai/api/search-image?query=Abstract%20geometric%20composition%20with%20warm%20golden%20amber%20and%20soft%20cream%20layered%20shapes%2C%20subtle%20gradient%20curves%20suggesting%20knowledge%20flow%2C%20minimalist%20clean%20aesthetic%2C%20architectural%20abstract%20forms%20with%20gentle%20shadows%2C%20serene%20academic%20atmosphere%2C%20no%20text%20no%20faces%20no%20sharp%20edges&width=1600&height=900&seq=landing-hero-2026&orientation=landscape"
            alt=""
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/30 to-black/50"></div>
        </div>

        <div className="relative z-10 w-full max-w-6xl mx-auto px-6 py-20 md:py-24">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-background-50/20 backdrop-blur-sm rounded-full border border-background-50/20 mb-6">
              <div className="w-2 h-2 rounded-full bg-accent-400 animate-pulse"></div>
              <span className="text-xs font-medium text-background-50/90">2026 秋季学期全新上线</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-background-50 leading-tight mb-5">
              让每一堂课
              <br />
              都留下清晰的
              <span className="text-accent-300">印记</span>
            </h1>

            <p className="text-base md:text-lg text-background-50/75 leading-relaxed mb-8 max-w-lg">
              智能录音转写、AI 摘要生成、日历课程管理——课堂纪要帮你高效记录、整理与共享每一堂课的精彩内容。
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => navigate('/register')}
                className="px-8 py-3.5 bg-accent-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-accent-600 transition-all cursor-pointer whitespace-nowrap shadow-lg shadow-accent-500/30"
              >
                免费开始使用
                <i className="ri-arrow-right-line ml-2"></i>
              </button>
              <button
                onClick={() => navigate('/login')}
                className="px-8 py-3.5 bg-background-50/15 backdrop-blur-sm text-background-50 rounded-xl text-sm font-medium hover:bg-background-50/25 transition-all cursor-pointer whitespace-nowrap border border-background-50/20"
              >
                已有账户？立即登录
              </button>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background-50 to-transparent"></div>
      </section>

      {/* Stats Bar */}
      <section className="relative -mt-12 z-20 max-w-4xl mx-auto px-6 mb-16">
        <div className="bg-background-50 rounded-2xl border border-background-200 grid grid-cols-2 md:grid-cols-4 divide-x divide-background-100 overflow-hidden">
          {stats.map((stat) => (
            <div key={stat.label} className="px-6 py-5 text-center">
              <p className="text-2xl md:text-3xl font-bold text-foreground-900 mb-0.5">{stat.value}</p>
              <p className="text-xs text-foreground-400">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <span className="inline-block px-3 py-1 bg-accent-100 text-accent-700 text-xs font-semibold rounded-full mb-4">
              核心功能
            </span>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground-900 mb-3">
              全方位的课堂管理工具
            </h2>
            <p className="text-sm text-foreground-400 max-w-lg mx-auto">
              从录音转写到 AI 摘要，从日历查看到共享协作，覆盖课堂纪要从生产到消费的每一个环节。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group bg-background-50 rounded-2xl border border-background-200 p-6 hover:border-accent-200 transition-all duration-300"
              >
                <div className="w-11 h-11 flex items-center justify-center bg-accent-100 rounded-xl mb-4 group-hover:bg-accent-200 transition-colors">
                  <i className={`${feature.icon} text-accent-600 text-xl`}></i>
                </div>
                <h3 className="text-base font-semibold text-foreground-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-foreground-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-16 md:py-20 bg-background-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <span className="inline-block px-3 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full mb-4">
              三步开始
            </span>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground-900 mb-3">
              简单三步，高效管理课堂
            </h2>
            <p className="text-sm text-foreground-400 max-w-lg mx-auto">
              无需复杂配置，注册即用，让技术真正为教学服务。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((item, idx) => (
              <div key={item.step} className="relative">
                {idx < steps.length - 1 && (
                  <div className="hidden md:block absolute top-12 left-[calc(50%+40px)] w-[calc(100%-80px)] h-px bg-background-300">
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 border-t border-r border-background-300"></div>
                  </div>
                )}
                <div className="text-center">
                  <span className="inline-block text-5xl font-bold text-background-200 mb-4">
                    {item.step}
                  </span>
                  <div className="w-14 h-14 flex items-center justify-center bg-primary-100 rounded-2xl mx-auto mb-4">
                    <i className={`${item.icon} text-primary-600 text-2xl`}></i>
                  </div>
                  <h3 className="text-base font-semibold text-foreground-900 mb-2">{item.title}</h3>
                  <p className="text-sm text-foreground-400 leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="cta" className="py-16 md:py-20 relative overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://readdy.ai/api/search-image?query=Warm%20minimalist%20abstract%20waves%20in%20golden%20amber%20and%20cream%20tones%2C%20soft%20flowing%20gradient%20curves%2C%20elegant%20smooth%20geometric%20overlapping%20layers%2C%20clean%20modern%20aesthetic%2C%20calm%20uplifting%20atmosphere%2C%20no%20text%20no%20faces%2C%20abstract%20organic%20shapes%20with%20gentle%20light%20gradient&width=1600&height=700&seq=landing-cta-2026&orientation=landscape"
            alt=""
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-accent-600/90 via-accent-500/80 to-accent-600/90"></div>
        </div>

        <div className="relative z-10 max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-background-50 mb-4">
            准备好提升课堂效率了吗？
          </h2>
          <p className="text-sm text-background-50/75 mb-8 leading-relaxed">
            立即注册课堂纪要，免费体验智能录音转写与 AI 摘要生成。无需绑定信用卡。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/register')}
              className="px-8 py-3.5 bg-background-50 text-accent-600 rounded-xl text-sm font-semibold hover:bg-background-100 transition-all cursor-pointer whitespace-nowrap shadow-lg"
            >
              免费注册，即刻开始
            </button>
            <button
              onClick={() => navigate('/login')}
              className="px-8 py-3.5 bg-transparent text-background-50 rounded-xl text-sm font-medium border border-background-50/30 hover:bg-background-50/10 transition-all cursor-pointer whitespace-nowrap"
            >
              已有账户？登录
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-background-100 border-t border-background-200 py-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 flex items-center justify-center bg-accent-500 rounded-lg">
                <i className="ri-book-open-line text-background-50"></i>
              </div>
              <span className="text-sm font-semibold text-foreground-800">课堂纪要</span>
            </div>

            <div className="flex items-center gap-6">
              <a href="#features" className="text-xs text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer whitespace-nowrap">功能</a>
              <a href="#how-it-works" className="text-xs text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer whitespace-nowrap">使用流程</a>
              <a href="/login" className="text-xs text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer whitespace-nowrap">登录</a>
              <a href="/register" className="text-xs text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer whitespace-nowrap">注册</a>
            </div>

            <p className="text-xs text-foreground-300">
              &copy; 2026 课堂纪要. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}