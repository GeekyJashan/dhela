import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Fire once when the element first scrolls into view. */
export function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/** Reveal children with a rise-in animation when scrolled into view. */
export function Reveal({ children, className, delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) {
  const { ref, inView } = useInView();
  return (
    <div ref={ref} className={cn("reveal", inView && "in", className)}
      style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/**
 * Count up to `to` once scrolled into view. `decimals` keeps fractional
 * targets readable; `format` handles suffixes like "%" or "+".
 */
export function CountUp({ to, duration = 1400, decimals = 0, format = (n: string) => n }: {
  to: number; duration?: number; decimals?: number; format?: (n: string) => string;
}) {
  const { ref, inView } = useInView(0.4);
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // ease-out cubic — fast then settles, so the final number reads as landing
      setValue(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);

  return <span ref={ref}>{format(value.toFixed(decimals))}</span>;
}
