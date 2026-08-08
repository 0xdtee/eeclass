import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface BackButtonProps {
  className?: string;
  children?: React.ReactNode;
}

// Unified back button: tap = go to previous page (or home if no history); long-press ≥500ms = go home.
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
    // A long-press already navigated, so a tap shouldn't trigger it again.
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
