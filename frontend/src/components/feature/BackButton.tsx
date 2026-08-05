import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface BackButtonProps {
  className?: string;
  children?: React.ReactNode;
}

// 统一返回按钮:轻点=返回上一页(无历史则回主界面);长按 ≥500ms=回主界面。
export default function BackButton({ className, children }: BackButtonProps) {
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const startPress = () => {
    longPressedRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      navigate('/');
    }, 500);
  };

  const endPress = () => {
    clearTimer();
  };

  const handleClick = () => {
    // 长按已经导航过了,轻点不再重复触发。
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      className={`select-none ${className ?? ''}`}
      title="轻点返回上一页,长按回主界面"
    >
      {children ?? <i className="ri-arrow-left-line" />}
    </button>
  );
}
