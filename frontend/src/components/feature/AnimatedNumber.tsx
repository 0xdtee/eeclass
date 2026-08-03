import { useState, useEffect, useRef } from 'react';

interface AnimatedNumberProps {
  value: number;
  suffix?: string;
  duration?: number;
}

export default function AnimatedNumber({ value, suffix = '', duration = 1200 }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const fromRef = useRef(0);   // 动画起点(上次显示值),保证连续不跳变

  // 进入视口后标记可见(触发一次即可)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.3 }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  // 可见后:value 每次变化都从当前值动画到新值。
  // 关键修复:数据是异步加载的(先 0 后 14),value 变了必须重新动画,不能只跑一次。
  useEffect(() => {
    if (!visible) return;
    const from = fromRef.current;
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const progress = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const cur = Math.round(from + (value - from) * eased);
      setDisplay(cur);
      fromRef.current = cur;
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, value, duration]);

  return (
    <span ref={ref}>
      {display.toLocaleString()}
      {suffix}
    </span>
  );
}
