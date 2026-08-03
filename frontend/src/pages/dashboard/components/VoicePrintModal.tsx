import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/base/Modal';
import { useRecords, type VoiceCluster } from '@/hooks/useRecords';
import { audioUrl } from '@/hooks/useLibrary';

/** 语音标记 / 声纹库:列出过去录音里的声音(同一个人已合并成一条),试听后打标签;
 *  之后录到同声纹的人自动用这身份。 */
export default function VoicePrintModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const records = useRecords();
  const [clusters, setClusters] = useState<VoiceCluster[]>([]);
  const [recognized, setRecognized] = useState<{ name: string; count: number }[]>([]);
  const [library, setLibrary] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});   // key sid:idx -> 输入的名字
  const [busy, setBusy] = useState('');
  const [playing, setPlaying] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRef = useRef<number | null>(null);

  const load = () => {
    setLoading(true); setErr('');
    records.listVoices()
      .then((r) => { setClusters(r.clusters || []); setRecognized(r.recognized || []); setLibrary(r.library || []); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (isOpen) load(); /* eslint-disable-next-line */ }, [isOpen]);

  const stopAudio = () => {
    if (stopRef.current) window.clearTimeout(stopRef.current);
    audioRef.current?.pause();
    setPlaying('');
  };
  useEffect(() => () => stopAudio(), []);

  const preview = (v: VoiceCluster) => {
    const key = `${v.sid}:${v.idx}`;
    if (playing === key) { stopAudio(); return; }
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    stopAudio();
    a.src = audioUrl(v.sid);
    setPlaying(key);
    const onMeta = () => {
      try { a.currentTime = v.sample_start || 0; } catch { /* ignore */ }
      void a.play().catch(() => setPlaying(''));
      stopRef.current = window.setTimeout(stopAudio, 5000);   // 试听 5 秒
      a.removeEventListener('loadedmetadata', onMeta);
    };
    a.addEventListener('loadedmetadata', onMeta);
  };

  const label = async (v: VoiceCluster) => {
    const key = `${v.sid}:${v.idx}`;
    const name = (names[key] || '').trim();
    if (!name) return;
    setBusy(key);
    try {
      await records.addVoiceprint({ name, embedding: v.embedding });
      setNames((n) => ({ ...n, [key]: '' }));
      stopAudio();
      load();   // 重新拉:这条及同声纹的其它条会归到"已识别"
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const del = async (id: string) => {
    setBusy(id);
    try { await records.deleteVoiceprint(id); load(); }
    finally { setBusy(''); }
  };

  const shortSid = (sid: string) => sid.replace(/^\d{4}-\d{2}-\d{2}_\d{4}_/, '');

  return (
    <Modal isOpen={isOpen} onClose={() => { stopAudio(); onClose(); }} title="语音标记 · 声纹库" width="max-w-lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        <p className="text-xs text-foreground-400 leading-relaxed">
          从你过去的录音里提取出每个人的声音。试听后给他打个名字,存进声纹库;之后录到<b>相同声纹</b>的人,会自动用这个名字记录。同一个人可能出现在多节课里,<b>标一次即可</b>,其余会自动识别。
        </p>

        {/* 声纹库 */}
        <div>
          <p className="text-xs font-semibold text-foreground-500 mb-1.5">声纹库({library.length})</p>
          {library.length === 0 ? (
            <p className="text-xs text-foreground-300">还没标记过声音。下面选一个试听、打标签。</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {library.map((v) => (
                <span key={v.id} className="flex items-center gap-1 pl-2.5 pr-1 py-1 bg-accent-100 text-accent-700 rounded-full text-xs font-medium">
                  <i className="ri-user-voice-line"></i>{v.name}
                  <button onClick={() => void del(v.id)} disabled={busy === v.id} className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-accent-200 cursor-pointer" title="从库里删除">
                    <i className="ri-close-line text-[11px]"></i>
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-foreground-400">正在从录音里提取声音…(首次较慢)</p>
          </div>
        ) : err ? (
          <p className="text-xs text-red-600"><i className="ri-error-warning-line mr-1"></i>{err}</p>
        ) : (
          <>
            {/* 待标记:同一个人已合并成一条 */}
            <div>
              <p className="text-xs font-semibold text-foreground-500 mb-1.5">待标记的人({clusters.length})</p>
              {clusters.length === 0 ? (
                <p className="text-xs text-foreground-300">没有待标记的声音了。</p>
              ) : (
                <div className="space-y-2">
                  {clusters.map((v) => {
                    const key = `${v.sid}:${v.idx}`;
                    return (
                      <div key={key} className="flex items-center gap-2 p-2.5 bg-background-50 border border-background-200 rounded-xl">
                        <button
                          onClick={() => preview(v)}
                          className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full cursor-pointer ${playing === key ? 'bg-accent-500 text-background-50' : 'bg-background-100 text-foreground-600 hover:bg-background-200'}`}
                          title="试听 5 秒"
                        >
                          <i className={playing === key ? 'ri-stop-fill' : 'ri-play-fill'}></i>
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-foreground-700 truncate">{v.name || '某人'} · 共 {v.seconds}s</p>
                          <p className="text-[11px] text-foreground-400 truncate">
                            出现在 {v.sessions} 节课 · {v.count} 段
                          </p>
                        </div>
                        <input
                          value={names[key] || ''}
                          onChange={(e) => setNames((n) => ({ ...n, [key]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') void label(v); }}
                          placeholder="他是谁?"
                          className="w-24 text-xs px-2.5 py-1.5 rounded-lg border border-background-200 bg-background-100 focus:outline-none focus:border-accent-400"
                        />
                        <button
                          onClick={() => void label(v)}
                          disabled={!(names[key] || '').trim() || busy === key}
                          className="px-3 py-1.5 bg-accent-500 text-background-50 rounded-full text-xs font-semibold hover:bg-accent-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {busy === key ? '…' : '标记'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 已识别 */}
            {recognized.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground-500 mb-1.5">已识别</p>
                <div className="flex flex-wrap gap-1.5">
                  {recognized.map((r) => (
                    <span key={r.name} className="px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-xs">
                      <i className="ri-checkbox-circle-line mr-1"></i>{r.name} · {r.count} 段
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
