import type { CSSProperties } from "react";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { frame: string; pad: string }> = {
  sm: { frame: "w-10 h-10 rounded-xl", pad: "p-1" },
  md: { frame: "w-14 h-14 rounded-2xl", pad: "p-1.5" },
  lg: { frame: "w-16 h-16 rounded-2xl", pad: "p-2" },
};

/**
 * Cadre premium unifié pour les logos de jeux (Aviator, CosmoX, JetX) :
 * même alignement, même respiration, rendu net et équilibré partout.
 */
export default function GameLogoFrame({
  src,
  alt,
  size = "md",
  className = "",
  style,
}: {
  src: string;
  alt: string;
  size?: Size;
  className?: string;
  style?: CSSProperties;
}) {
  const s = SIZES[size];
  return (
    <div
      className={`relative shrink-0 ${s.frame} overflow-hidden bg-[hsl(var(--card))]/80 ring-1 ring-border/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_14px_-6px_rgba(0,0,0,0.6)] flex items-center justify-center ${className}`}
      style={style}
    >
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.07] to-transparent" />
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`relative w-full h-full object-contain object-center ${s.pad} drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition-transform duration-500 group-hover:scale-105`}
      />
    </div>
  );
}
