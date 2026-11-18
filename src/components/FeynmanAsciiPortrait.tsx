import React from "react";
import { motion } from "motion/react";
import { FEYNMAN_ASCII_DARK, FEYNMAN_ASCII_LIGHT } from "../lib/feynmanAscii";
import { useTheme } from "../lib/theme";

interface FeynmanAsciiPortraitProps {
  variant?: "hero" | "compact";
  caption?: string;
  quote?: string;
}

export default function FeynmanAsciiPortrait({
  variant = "hero",
  caption = "Richard P. Feynman · 1918–1988",
  quote = "What I cannot create, I do not understand.",
}: FeynmanAsciiPortraitProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const asciiArt = isDark ? FEYNMAN_ASCII_DARK : FEYNMAN_ASCII_LIGHT;

  if (variant === "compact") {
    return (
      <div
        id="feynman-ascii-mentor-card"
        className="rounded-2xl border border-[#e5e0ec] dark:border-white/[0.08] bg-white dark:bg-[#0b0b1a]/85 p-4 flex flex-col items-center text-center shadow-[0_2px_16px_rgba(20,18,29,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.35)] transition-colors"
      >
        <div className="w-full flex items-center justify-between border-b border-[#efeaf5] dark:border-white/[0.06] pb-2.5 mb-3">
          <span className="text-[11px] font-semibold tracking-wide text-[#5a536e] dark:text-slate-400">
            Feynman Mentor
          </span>
          <span className="text-[10px] font-mono text-purple-700 dark:text-[#d946ef] font-medium">
            ASCII Edition
          </span>
        </div>

        <div className="w-full overflow-hidden flex justify-center py-1 rounded-xl bg-[#faf8f5] dark:bg-[#060611] border border-[#efeaf5] dark:border-white/[0.05]">
          <pre
            aria-label="ASCII portrait of Richard Feynman"
            className="font-mono text-[4.2px] leading-[1.08] tracking-[-0.02em] text-[#1c1929] dark:text-[#e9e4f5] select-none whitespace-pre px-2 py-2"
          >
            {asciiArt}
          </pre>
        </div>

        <div className="mt-3 space-y-1">
          <p className="font-serif italic text-xs text-[#3b354f] dark:text-slate-300 leading-snug">
            &ldquo;{quote}&rdquo;
          </p>
          <p className="text-[10px] font-mono text-[#78718c] dark:text-slate-500">
            {caption}
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.aside
      id="feynman-ascii-portrait"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      className="relative flex flex-col items-center justify-center w-full"
    >
      {/* Subtle ambient halo behind the gallery frame */}
      <div
        aria-hidden="true"
        className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-purple-200/40 via-fuchsia-100/20 to-transparent dark:from-purple-700/15 dark:via-[#d946ef]/10 dark:to-transparent blur-2xl pointer-events-none"
      />

      <div className="relative w-full max-w-[440px] rounded-2xl border border-[#e4dfec] dark:border-white/[0.09] bg-white/95 dark:bg-[#0b0b1a]/90 p-5 sm:p-6 shadow-[0_12px_40px_-12px_rgba(20,18,29,0.09)] dark:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.65)] backdrop-blur-md transition-colors">
        {/* Clean editorial plate header */}
        <div className="flex items-center justify-between text-[11px] text-[#78718c] dark:text-slate-400 border-b border-[#efeaf5] dark:border-white/[0.07] pb-3 mb-4">
          <span className="font-medium tracking-wide text-[#2a2538] dark:text-slate-200">
            Portrait Study
          </span>
          <span className="font-mono text-[10px] text-purple-700 dark:text-[#d946ef]">
            68 × 39 ASCII
          </span>
        </div>

        {/* Crisp Monospace Portrait Canvas */}
        <div className="w-full flex items-center justify-center rounded-xl bg-[#faf8f5] dark:bg-[#05050d] border border-[#efeaf5] dark:border-white/[0.05] py-4 px-2 overflow-hidden group">
          <pre
            aria-label="ASCII art portrait of physicist Richard Feynman"
            className="font-mono text-[4.8px] sm:text-[5.8px] lg:text-[5.4px] xl:text-[6.2px] leading-[1.06] tracking-[-0.015em] text-[#171424] dark:text-[#ede9f8] group-hover:text-purple-950 dark:group-hover:text-white transition-colors duration-300 select-none whitespace-pre"
          >
            {asciiArt}
          </pre>
        </div>

        {/* Unboxed editorial attribution & Feynman quote */}
        <div className="mt-4 pt-3 border-t border-[#efeaf5] dark:border-white/[0.07] flex flex-col gap-1.5 text-left">
          <p className="font-serif italic text-[13px] sm:text-sm text-[#2d273f] dark:text-slate-200 leading-relaxed">
            &ldquo;{quote}&rdquo;
          </p>
          <div className="flex items-center gap-2 text-[11px] font-mono text-[#78718c] dark:text-slate-400">
            <span>{caption}</span>
            <span aria-hidden="true">·</span>
            <span>Quantum Electrodynamics</span>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
