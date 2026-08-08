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
  const fromRef = useRef(0);   // Animation start point (last shown value), keeps it continuous without jumps

  // Mark visible once it enters the viewport (triggering once is enough)
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

  // Once visible: every time value changes, animate from the current value to the new one.
  // Key fix: data loads asynchronously (0 first, then 14), so when value changes we must re-animate, not run only once.
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
