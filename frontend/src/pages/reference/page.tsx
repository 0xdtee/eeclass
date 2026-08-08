import { useState, useEffect, useMemo } from 'react';
import BackButton from '@/components/feature/BackButton';
import { useRecords, officialPdfUrl, officialPageUrl, type OfficialSchool } from '@/hooks/useRecords';

const CATS: { name: string; icon: string; kws: string[] }[] = [
  { name: '数学', icon: 'ri-functions', kws: ['数学', '代数', '概率', '统计', '离散'] },
  { name: '物理 / 力学', icon: 'ri-magic-line', kws: ['物理', '力学'] },
  { name: '计算机', icon: 'ri-code-s-slash-line', kws: ['计算机', '程序', '数据结构', 'C语言', '算法'] },
  { name: '化学', icon: 'ri-flask-line', kws: ['化学'] },
  { name: '语言', icon: 'ri-translate-2', kws: ['英语', '语文', '外语'] },
  { name: '思政 / 通识', icon: 'ri-government-line', kws: ['马克思', '毛泽东', '习近平', '思想', '历史', '近现代', '形势', '军事', '心理', '法治', '道德'] },
  { name: '工程 / 其他', icon: 'ri-tools-line', kws: [] },
];
function catOf(course: string): string {
  for (const c of CATS) if (c.kws.some((k) => course.includes(k))) return c.name;
  return '工程 / 其他';
}

type Item = OfficialSchool['items'][number];

export default function ReferencePage() {
  const records = useRecords();
  const [schools, setSchools] = useState<OfficialSchool[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [course, setCourse] = useState('');
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    void records.listSchools().then((r) => {
      const list = r.schools || [];
      setSchools(list);
      if (list.length) {
        setSchoolId(list[0].id);
        if (list[0].items.length) setCourse(list[0].items[0].course);
      }
    }).catch(() => {}).finally(() => setLoading(false));
    // eslint-disable-next-line
  }, []);

  const school = useMemo(() => schools.find((s) => s.id === schoolId) || null, [schools, schoolId]);
  const item: Item | undefined = useMemo(
    () => school?.items.find((i) => i.course === course),
    [school, course]
  );

  // Switch school: auto-select that school's first course (if the current course doesn't belong to it)
  useEffect(() => {
    if (!school) return;
    if (!school.items.some((i) => i.course === course)) {
      setCourse(school.items[0]?.course || '');
    }
    // eslint-disable-next-line
  }, [schoolId]);

  useEffect(() => { if (item) setPdfLoading(true); }, [schoolId, course]);

  const grouped = useMemo(() => {
    const items = school?.items || [];
    const g = new Map<string, Item[]>();
    CATS.forEach((c) => g.set(c.name, []));
    items.forEach((it) => g.get(catOf(it.course))!.push(it));
    return CATS.map((c) => ({ ...c, list: g.get(c.name) || [] })).filter((c) => c.list.length);
  }, [school]);

  const isPage = item?.kind === 'page';
  const pdfSrc = item ? (isPage ? officialPageUrl(schoolId, course) : officialPdfUrl(schoolId, course)) : '';

  return (
    <div className="min-h-screen bg-background-100">
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center justify-between h-14 px-6 max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <BackButton className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 cursor-pointer" />
            <div>
              <h1 className="text-sm font-semibold text-foreground-900">参考资料 · 官方教学大纲</h1>
              <p className="text-xs text-foreground-400">选择学校 → 查看该校教务处发布的课程教学大纲 PDF</p>
            </div>
          </div>
          {item && (
            <a href={isPage ? (item.source_page || pdfSrc) : pdfSrc} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-background-50 rounded-full text-xs font-semibold hover:bg-primary-600 cursor-pointer whitespace-nowrap">
              <i className="ri-external-link-line"></i>{isPage ? '打开原网页' : '新标签打开'}
            </a>
          )}
        </div>
      </nav>

      {/* School selector */}
      {schools.length > 0 && (
        <div className="border-b border-background-200 bg-background-50">
          <div className="max-w-6xl mx-auto px-6 flex items-center gap-2 overflow-x-auto py-2.5">
            <span className="text-xs text-foreground-400 flex-shrink-0 mr-1"><i className="ri-school-line mr-1"></i>学校</span>
            {schools.map((s) => (
              <button
                key={s.id}
                onClick={() => setSchoolId(s.id)}
                className={`px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap cursor-pointer transition-colors ${schoolId === s.id ? 'bg-accent-500 text-background-50 font-semibold' : 'bg-background-100 text-foreground-600 hover:bg-background-200'}`}
              >
                {s.name}<span className={`ml-1.5 text-[10px] ${schoolId === s.id ? 'text-background-50/70' : 'text-foreground-400'}`}>{s.items.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row gap-5 items-start">
        {/* Left: this school's course list */}
        <div className="w-full md:w-64 flex-shrink-0 space-y-4">
          {grouped.map((c) => (
            <div key={c.name}>
              <p className="text-xs font-semibold text-foreground-400 mb-1.5 flex items-center gap-1.5"><i className={c.icon}></i>{c.name}</p>
              <div className="space-y-1">
                {c.list.map((it) => (
                  <button
                    key={it.course}
                    onClick={() => setCourse(it.course)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors flex items-center gap-1.5 ${course === it.course ? 'bg-accent-500 text-background-50 font-semibold' : 'text-foreground-700 hover:bg-background-50'}`}
                  >
                    <span className="flex-1 truncate">{it.course}</span>
                    {it.kind === 'page' && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${course === it.course ? 'bg-background-50/25 text-background-50' : 'bg-sky-100 text-sky-700'}`}>网页</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Right: official PDF preview */}
        <div className="flex-1 min-w-0 w-full">
          {loading ? (
            <div className="flex items-center justify-center py-24"><div className="w-7 h-7 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div></div>
          ) : schools.length === 0 ? (
            <div className="text-center py-24 bg-background-50 border border-background-200 rounded-xl">
              <i className="ri-file-search-line text-3xl text-foreground-300"></i>
              <p className="text-sm text-foreground-400 mt-3">官方大纲正在整理中,稍后再来看看。</p>
            </div>
          ) : item ? (
            <div className="space-y-3">
              <div className="bg-background-50 border border-background-200 rounded-xl px-5 py-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold whitespace-nowrap">{school?.name}官方</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${isPage ? 'bg-sky-100 text-sky-700' : 'bg-background-100 text-foreground-500'}`}>{isPage ? '网页版' : 'PDF'}</span>
                <h2 className="text-sm font-bold text-foreground-900 truncate">{item.title}</h2>
                {item.source_page && (
                  <a href={item.source_page} target="_blank" rel="noreferrer" className="ml-auto text-xs text-primary-500 hover:underline whitespace-nowrap"><i className="ri-links-line mr-1"></i>来源页</a>
                )}
              </div>
              {item.note && <p className="text-xs text-foreground-400 px-1">{item.note}</p>}
              <div className="relative">
                {pdfLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background-50/80 rounded-xl z-10">
                    <div className="w-7 h-7 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm text-foreground-400">{isPage ? '正在加载官方网页大纲…' : '正在加载官方 PDF…'}</p>
                  </div>
                )}
                <iframe
                  title="官方教学大纲"
                  src={pdfSrc}
                  onLoad={() => setPdfLoading(false)}
                  className="w-full rounded-xl border border-background-200 bg-white"
                  style={{ height: '80vh' }}
                />
              </div>
              <p className="text-[11px] text-foreground-300 text-center">若长时间空白,可能是该校资料需校内网访问,点右上{isPage ? '「打开原网页」' : '「新标签打开」'}或「来源页」试试。</p>
            </div>
          ) : (
            <p className="text-sm text-foreground-400 py-24 text-center">这所学校暂时还没有收录课程大纲。</p>
          )}
        </div>
      </div>
    </div>
  );
}
