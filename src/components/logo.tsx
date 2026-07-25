import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Dhela brand mark.
 *
 * A ढेला was the small copper coin of everyday Indian trade — the one in
 * "ek dhela bhi nahi". So the mark is a struck coin: milled edge, gold face,
 * a serif D on the die, and two ledger rules under it. The name and the
 * promise ("har dhela hisaab mein") are the same object.
 *
 * Motion: the coin is minted on mount (spins in and settles), flips once
 * every few seconds so it stays alive in the sidebar, and carries a constant
 * specular sweep. `ambient` adds a hero glow + float for the landing page.
 * All of it is disabled under prefers-reduced-motion.
 */
export function Logo({
  size = 24,
  className,
  withWordmark = true,
  wordmarkClassName,
  ambient = false,
  idle = true,
}: {
  size?: number;
  className?: string;
  withWordmark?: boolean;
  wordmarkClassName?: string;
  ambient?: boolean;
  idle?: boolean;
}) {
  return (
    <span className={cn("dhela-logo inline-flex items-center select-none", className)}
      style={{ gap: Math.max(6, size * 0.28) }}>
      <DhelaCoin size={size} ambient={ambient} idle={idle} />
      {withWordmark && <Wordmark className={wordmarkClassName} size={size} />}
    </span>
  );
}

/** The coin only — for favicons-in-UI spots like the assistant launcher. */
export function DhelaCoin({ size = 24, ambient = false, idle = true }: {
  size?: number; ambient?: boolean; idle?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const face = `dhela-face-${uid}`;
  const rim = `dhela-rim-${uid}`;

  return (
    <span className="dhela-mark relative inline-block shrink-0"
      style={{ width: size, height: size, perspective: size * 6 }}>
      {ambient && <span aria-hidden className="dhela-glow" />}
      <span className={cn("dhela-coin relative block h-full w-full", idle && "dhela-coin-idle")}>
        <svg viewBox="0 0 48 48" width={size} height={size} className="block" aria-hidden>
          <defs>
            <linearGradient id={face} x1="0.15" y1="0" x2="0.85" y2="1">
              <stop offset="0%" stopColor="oklch(0.93 0.09 90)" />
              <stop offset="42%" stopColor="oklch(0.82 0.145 68)" />
              <stop offset="100%" stopColor="oklch(0.62 0.13 55)" />
            </linearGradient>
            <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="oklch(0.88 0.1 80)" />
              <stop offset="100%" stopColor="oklch(0.55 0.12 52)" />
            </linearGradient>
          </defs>

          {/* struck blank */}
          <circle cx="24" cy="24" r="22.5" fill={`url(#${face})`} />
          {/* milled (reeded) edge — dashes on a thick stroke read as coin knurling */}
          <circle cx="24" cy="24" r="21" fill="none" stroke={`url(#${rim})`}
            strokeWidth="3.4" strokeDasharray="1.15 2.35" />
          {/* recessed inner field */}
          <circle cx="24" cy="24" r="17.4" fill="none"
            stroke="oklch(0.34 0.07 200 / 0.45)" strokeWidth="1.15" />

          {/* the die: serif D */}
          <text x="24" y="31.6" textAnchor="middle"
            fontFamily="'Instrument Serif', Georgia, serif"
            fontSize="23" fill="oklch(0.24 0.045 200)">D</text>
          {/* ledger rules struck under the letter */}
          <path d="M16.6 35.4h14.8M18.9 38.1h10.2" stroke="oklch(0.24 0.045 200 / 0.55)"
            strokeWidth="1.15" strokeLinecap="round" />

          {/* specular highlight + contact shadow give it metal */}
          <path d="M9.6 17.4A16.4 16.4 0 0 1 22.6 7.8" fill="none"
            stroke="oklch(1 0 0 / 0.5)" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M38.2 30.4A16 16 0 0 1 27.8 40" fill="none"
            stroke="oklch(0.45 0.1 50 / 0.35)" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span aria-hidden className="dhela-shine" />
      </span>
    </span>
  );
}

const LETTERS = ["D", "h", "e", "l", "a"];

function Wordmark({ className, size }: { className?: string; size: number }) {
  return (
    <span className={cn("dhela-word font-display leading-none tracking-tight", className)}
      style={{ fontSize: size * 0.92 }}>
      {LETTERS.map((ch, i) => (
        <span key={i} style={{ animationDelay: `${180 + i * 55}ms` }}>{ch}</span>
      ))}
    </span>
  );
}
