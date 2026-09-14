import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render error anywhere below it. Without this React unmounts the whole tree and the user is
 * left staring at a blank page with no way out -- particularly bad mid-recording, where the session is
 * still running on the server and the page is the only way back to it.
 */
interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep it in the console too, so a report can point at the real stack rather than "it went white".
    console.error('页面渲染出错:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen bg-background-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-background-50 border border-background-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-red-600 mb-3">
            <i className="ri-error-warning-line text-xl"></i>
            <h1 className="text-base font-semibold">页面出错了</h1>
          </div>
          <p className="text-sm text-foreground-600 leading-relaxed">
            这一页没能正常显示。录音如果还在进行，服务器那边不受影响——刷新后回到录音页就能接上。
          </p>
          <pre className="mt-3 p-3 bg-background-100 rounded-lg text-[11px] text-foreground-500 overflow-x-auto whitespace-pre-wrap">
            {String(error?.message || error)}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 cursor-pointer"
            >
              刷新这一页
            </button>
            <button
              onClick={() => { window.location.href = '/app/'; }}
              className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 cursor-pointer"
            >
              回主界面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
