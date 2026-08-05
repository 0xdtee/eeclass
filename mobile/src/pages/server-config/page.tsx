import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setServerUrl, getServerUrl, apiFetch } from '@/lib/api';

export default function ServerConfigPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState(getServerUrl());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setUrl(getServerUrl());
  }, []);

  const handleTest = async () => {
    if (!url.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Temporarily set the URL for the test
      setServerUrl(url.trim());
      const data = await apiFetch<{ ok?: boolean; require_token?: boolean; deepseek?: boolean; error?: string }>('/health');
      if (data.error) {
        setTestResult({ ok: false, msg: data.error });
      } else {
        const parts: string[] = ['后端已连接'];
        if (data.require_token) parts.push('需要登录');
        if (data.deepseek) parts.push('DeepSeek 可用');
        setTestResult({ ok: true, msg: parts.join(' · ') });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!url.trim()) return;
    setServerUrl(url.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleContinue = () => {
    if (!url.trim()) return;
    setServerUrl(url.trim());
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-accent-100 rounded-2xl mx-auto mb-4">
            <i className="ri-server-line text-accent-600 text-2xl"></i>
          </div>
          <h1 className="text-xl font-bold text-foreground-900">配置后端服务器</h1>
          <p className="text-sm text-foreground-400 mt-2">
            首次使用需要连接到你自己的识别服务
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">
              后端地址
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                <i className="ri-link text-foreground-400 text-sm"></i>
              </div>
              <input
                type="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setTestResult(null); }}
                placeholder="https://192.168.1.100:5901"
                className="w-full pl-10 pr-4 py-3 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
              />
            </div>
            <p className="text-xs text-foreground-400 mt-1.5">
              形如 https://&lt;IP或域名&gt;:5901，必须使用 HTTPS
            </p>
          </div>

          <button
            onClick={handleTest}
            disabled={testing || !url.trim()}
            className="w-full py-3 bg-background-100 border border-background-200 text-foreground-700 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            {testing ? (
              <span className="flex items-center justify-center gap-2">
                <i className="ri-loader-4-line animate-spin"></i>
                测试连接中…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <i className="ri-wifi-line"></i>
                测试连接
              </span>
            )}
          </button>

          {testResult && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${
              testResult.ok
                ? 'bg-accent-50 border border-accent-200 text-accent-700'
                : 'bg-red-50 border border-red-200 text-red-600'
            }`}>
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                <i className={`${testResult.ok ? 'ri-check-line' : 'ri-error-warning-line'} text-lg`}></i>
              </div>
              <span>{testResult.msg}</span>
            </div>
          )}

          <div className="pt-2 space-y-3">
            <button
              onClick={handleSave}
              className="w-full py-3 bg-accent-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              {saved ? (
                <span className="flex items-center justify-center gap-2">
                  <i className="ri-check-line"></i>
                  已保存
                </span>
              ) : (
                '保存地址'
              )}
            </button>

            <button
              onClick={handleContinue}
              disabled={!url.trim()}
              className="w-full py-3 bg-primary-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              继续到登录页
            </button>
          </div>
        </div>

        <div className="mt-6 p-4 bg-background-100 rounded-xl border border-background-200">
          <p className="text-xs text-foreground-500 leading-relaxed">
            <i className="ri-shield-check-line mr-1 text-accent-500"></i>
            <strong>隐私说明</strong>：录音、识别、说话人区分全部在你自己的设备上完成，音频不会上传到任何第三方服务器。只有文本片段可能发给大模型做纠错和摘要。
          </p>
        </div>
      </div>
    </div>
  );
}