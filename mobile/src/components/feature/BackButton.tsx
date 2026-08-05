import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface BackButtonProps {
  label?: string;
  className?: string;
}

/**
 * 统一返回按钮:
 *  · 轻点 → 回上一页(navigate(-1);没有上一页则回主界面)
 *  · 长按(≥500ms)→ 直接回主界面
 */
export default function BackButton({ label = '返回', className }: BackButtonProps) {
  const navigate = useNavigate();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const startPress = () => {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      navigate('/'); // 长按回主界面
    }, 500);
  };

  const cancelPress = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const handleClick = () => {
    if (longPressed.current) return; // 已由长按处理
    // 回上一页;历史栈没有上一页时回主界面
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <button
      onClick={handleClick}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
      className={
        className ??
        'flex items-center gap-1.5 text-sm text-foreground-400 hover:text-foreground-600 mb-3 cursor-pointer select-none'
      }
      title="轻点返回上一页,长按回主界面"
    >
      <i className="ri-arrow-left-line"></i>
      <span>{label}</span>
    </button>
  );
}
