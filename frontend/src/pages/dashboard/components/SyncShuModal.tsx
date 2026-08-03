import { useState } from 'react';
import Modal from '@/components/base/Modal';
import type { ScheduleEvent } from '@/hooks/useRecords';

interface SyncShuModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSync: (username: string, password: string) => Promise<{ events: ScheduleEvent[]; note?: string; error?: string }>;
  onConfirmEvents: (events: ScheduleEvent[]) => void;
}

export default function SyncShuModal({ isOpen, onClose, onSync, onConfirmEvents }: SyncShuModalProps) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [events, setEvents] = useState<ScheduleEvent[]>([]);

  const reset = () => { setBusy(false); setMsg(''); setErr(''); setEvents([]); };
  const close = () => { reset(); setU(''); setP(''); onClose(); };

  const go = async () => {
    if (!u.trim() || !p) { setErr('请输入学/工号和密码'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await onSync(u.trim(), p);
      if (r.error) { setErr(r.error); }
      else { setEvents(r.events || []); setMsg(r.note || '完成'); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="上大选课 → 同步日历" width="max-w-md">
      <div className="space-y-4">
        {/* 第一步:去上大官网选课 */}
        <div className="rounded-xl border border-background-200 p-3.5">
          <p className="text-xs font-semibold text-foreground-800 mb-2 flex items-center gap-2">
            <span className="w-5 h-5 flex items-center justify-center bg-accent-100 text-accent-700 rounded-full text-[11px]">1</span>
            先去上大官网选课
          </p>
          <a
            href="https://jwxt.shu.edu.cn"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 w-full py-2.5 bg-primary-500 text-background-50 rounded-full text-sm font-semibold hover:bg-primary-600 cursor-pointer"
          >
            <i className="ri-external-link-line"></i>打开上大选课官网
          </a>
          <p className="text-[11px] text-foreground-400 mt-2 leading-relaxed">
            在官网正常登录、选课、点确定。选好后回到这里做第二步——把已选课程同步进日历。
          </p>
        </div>

        {/* 第二步:同步已选课程到日历 */}
        <div className="rounded-xl border border-background-200 p-3.5 space-y-3">
          <p className="text-xs font-semibold text-foreground-800 flex items-center gap-2">
            <span className="w-5 h-5 flex items-center justify-center bg-accent-100 text-accent-700 rounded-full text-[11px]">2</span>
            把已选课程同步到日历
          </p>
          <p className="text-[11px] text-foreground-400 leading-relaxed">
            用你的<b>上大统一身份认证</b>学工号+密码登录教务系统,抓取你已选的课表加进日历。密码<b>只用于这次登录、不保存</b>。
          </p>

          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">学 / 工号</label>
            <input
              value={u}
              onChange={(e) => setU(e.target.value)}
              className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm focus:outline-none focus:border-accent-400"
              placeholder="学号"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">密码</label>
            <input
              type="password"
              value={p}
              onChange={(e) => setP(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void go(); }}
              className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm focus:outline-none focus:border-accent-400"
              placeholder="统一身份认证密码"
            />
          </div>

          {err && <p className="text-xs text-red-600"><i className="ri-error-warning-line mr-1"></i>{err}</p>}
          {msg && (
            <div className="text-xs text-foreground-600 bg-background-100 rounded-lg p-3">
              <i className="ri-checkbox-circle-line text-green-500 mr-1"></i>{msg}
              {events.length > 0 && <span className="ml-1">识别到 {events.length} 节课。</span>}
            </div>
          )}

          {events.length > 0 ? (
            <button
              onClick={() => { onConfirmEvents(events); close(); }}
              className="w-full py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 cursor-pointer"
            >
              加入日历（{events.length} 节）
            </button>
          ) : (
            <button
              onClick={() => void go()}
              disabled={busy}
              className="w-full py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? '登录并同步中…(约 20 秒)' : '同步已选课程到日历'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
