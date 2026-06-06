"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type Point = {
  x: number;
  y: number;
};

type WaveConfig = {
  offset: number;
  amplitude: number;
  frequency: number;
  speed: number;
  lineWidth: number;
  shadowBlur: number;
  color: string;
  opacity: number;
};

const HERO_METRICS = [
  { label: "Live agents", value: "12", note: "core workflows" },
  { label: "Avg task price", value: "~$0.009", note: "current default pricing" },
  { label: "Settlement rail", value: "Arc + USDC", note: "wallet-aware execution" },
  { label: "Channels", value: "Web + Telegram", note: "one flow across both" },
] as const;

const HERO_PROOF_POINTS = [
  "Hermes reasoning",
  "Wallet-aware execution",
  "Web + Telegram",
] as const;

const WAVE_CONFIG: WaveConfig[] = [
  {
    offset: 0,
    amplitude: 26,
    frequency: 0.0082,
    speed: 0.022,
    lineWidth: 2,
    shadowBlur: 12,
    color: "rgba(242, 202, 80, 0.9)",
    opacity: 0.42,
  },
  {
    offset: Math.PI / 3,
    amplitude: 36,
    frequency: 0.0068,
    speed: 0.017,
    lineWidth: 1.8,
    shadowBlur: 7,
    color: "rgba(242, 202, 80, 0.68)",
    opacity: 0.3,
  },
  {
    offset: Math.PI / 1.9,
    amplitude: 48,
    frequency: 0.0056,
    speed: 0.014,
    lineWidth: 1.5,
    shadowBlur: 0,
    color: "rgba(255, 255, 255, 0.24)",
    opacity: 0.2,
  },
  {
    offset: Math.PI,
    amplitude: 58,
    frequency: 0.0047,
    speed: 0.011,
    lineWidth: 1.2,
    shadowBlur: 0,
    color: "rgba(242, 202, 80, 0.3)",
    opacity: 0.14,
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function AgentFlowWaveHero() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });
  const targetRef = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;

    if (!section || !canvas) {
      return undefined;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canTrackPointer =
      !prefersReducedMotion && window.matchMedia("(pointer: fine)").matches;
    const frameInterval = prefersReducedMotion ? 1000 / 18 : 1000 / 36;

    let animationId = 0;
    let time = 0;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let isVisible = true;
    let isDocumentVisible = document.visibilityState !== "hidden";
    let isAnimating = false;
    let lastPaint = 0;

    const centerPoint = (): Point => ({
      x: width / 2,
      y: height * 0.58,
    });

    const syncCanvas = () => {
      const bounds = section.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(window.devicePixelRatio || 1, canTrackPointer ? 1.35 : 1.15);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const center = centerPoint();
      pointerRef.current = center;
      targetRef.current = center;
    };

    const resizeObserver = new ResizeObserver(syncCanvas);
    resizeObserver.observe(section);
    window.addEventListener("resize", syncCanvas);

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = section.getBoundingClientRect();
      targetRef.current = {
        x: clamp(event.clientX - bounds.left, 0, width),
        y: clamp(event.clientY - bounds.top, 0, height),
      };
    };

    const handlePointerLeave = () => {
      targetRef.current = centerPoint();
    };

    if (canTrackPointer) {
      section.addEventListener("pointermove", handlePointerMove, { passive: true });
      section.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    }

    const drawWave = (wave: WaveConfig) => {
      const sampleStep = width > 1440 ? 12 : width > 960 ? 9 : 7;

      ctx.save();
      ctx.beginPath();

      for (let x = 0; x <= width; x += sampleStep) {
        const dx = x - pointerRef.current.x;
        const dy = height * 0.62 - pointerRef.current.y;
        const distance = Math.hypot(dx, dy);
        const influence = canTrackPointer ? Math.max(0, 1 - distance / 300) : 0;
        const interaction =
          influence * 26 * Math.sin(time * 0.017 + x * 0.018 + wave.offset);

        const y =
          height * 0.64 +
          Math.sin(x * wave.frequency + time * wave.speed + wave.offset) * wave.amplitude +
          Math.sin(x * wave.frequency * 0.42 + time * wave.speed * 1.35 + wave.offset * 0.5) *
            (wave.amplitude * 0.46) +
          interaction;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = wave.color;
      ctx.lineWidth = wave.lineWidth;
      ctx.globalAlpha = wave.opacity;
      ctx.shadowBlur = wave.shadowBlur;
      ctx.shadowColor = wave.shadowBlur > 0 ? wave.color : "transparent";
      ctx.stroke();
      ctx.restore();
    };

    const renderFrame = () => {
      if (canTrackPointer) {
        pointerRef.current.x += (targetRef.current.x - pointerRef.current.x) * 0.08;
        pointerRef.current.y += (targetRef.current.y - pointerRef.current.y) * 0.08;
      } else {
        const center = centerPoint();
        pointerRef.current = center;
        targetRef.current = center;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      WAVE_CONFIG.forEach(drawWave);
    };

    const stopAnimation = () => {
      if (!isAnimating) {
        return;
      }
      cancelAnimationFrame(animationId);
      isAnimating = false;
    };

    const shouldAnimate = () => isVisible && isDocumentVisible;

    const animate = (now: number) => {
      if (!shouldAnimate()) {
        isAnimating = false;
        return;
      }

      animationId = window.requestAnimationFrame(animate);
      if (now - lastPaint < frameInterval) {
        return;
      }

      lastPaint = now;
      time += prefersReducedMotion ? 0.22 : 1;
      renderFrame();
    };

    const startAnimation = () => {
      if (isAnimating || !shouldAnimate()) {
        return;
      }
      isAnimating = true;
      lastPaint = 0;
      animationId = window.requestAnimationFrame(animate);
    };

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? true;
        if (isVisible) {
          startAnimation();
        } else {
          stopAnimation();
        }
      },
      { threshold: 0.08 },
    );
    visibilityObserver.observe(section);

    const handleVisibilityChange = () => {
      isDocumentVisible = document.visibilityState !== "hidden";
      if (isDocumentVisible) {
        startAnimation();
      } else {
        stopAnimation();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    syncCanvas();
    renderFrame();
    startAnimation();

    return () => {
      window.removeEventListener("resize", syncCanvas);
      if (canTrackPointer) {
        section.removeEventListener("pointermove", handlePointerMove);
        section.removeEventListener("pointerleave", handlePointerLeave);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      stopAnimation();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative isolate overflow-hidden border-b border-[#2b2418] bg-[#090909]"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      />

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(8,8,8,0.08)_0%,rgba(8,8,8,0.24)_45%,rgba(8,8,8,0.78)_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100svh-74px)] max-w-7xl flex-col justify-center px-6 pb-16 pt-32 text-center md:px-12 md:pb-20">
        <div className="mx-auto max-w-4xl">
          <h1 className="font-headline text-5xl font-black leading-[0.94] text-white md:text-7xl lg:text-[6.6rem]">
            AgentFlow
            <span className="mt-3 block gold-gradient-text font-medium italic">
              Run onchain work from one wallet-aware workspace.
            </span>
          </h1>

          <p className="mx-auto mt-8 max-w-3xl text-base leading-7 text-[#d0c5af]/88 md:text-xl md:leading-8">
            AgentFlow combines Hermes-powered chat, dedicated agent services, AgentPay,
            funding controls, portfolio views, and execution proof in one product.
            Start from web or Telegram, confirm wallet actions when needed, and settle work in USDC on Arc.
          </p>

          <div className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-3 text-left">
            {HERO_PROOF_POINTS.map((point) => (
              <div
                key={point}
                className="inline-flex items-center gap-2 rounded-full border border-[#4d4635]/35 bg-[rgba(19,19,19,0.42)] px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-[#d0c5af]/82 backdrop-blur-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#f2ca50]" />
                {point}
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/chat"
              className="af-btn-primary af-focusable af-transition inline-flex min-h-12 items-center justify-center px-6 py-3 text-sm font-bold uppercase tracking-[0.18em]"
            >
              Open chat
            </Link>
            <Link
              href="/agents"
              className="af-btn-ghost af-focusable af-transition inline-flex min-h-12 items-center justify-center px-6 py-3 text-sm font-bold uppercase tracking-[0.18em]"
            >
              Browse agents
            </Link>
          </div>

          <p className="mt-7 text-[11px] uppercase tracking-[0.22em] text-[#d0c5af]/64">
            {"Pay per task \u00b7 Hermes reasoning \u00b7 Wallet confirmation \u00b7 Onchain settlement"}
          </p>
        </div>

        <dl className="mx-auto mt-14 grid w-full max-w-5xl gap-5 border-t border-[#4d4635]/28 pt-8 text-left sm:grid-cols-2 lg:grid-cols-4">
          {HERO_METRICS.map((metric) => (
            <div
              key={metric.label}
              className="rounded-[22px] border border-[#4d4635]/18 bg-[rgba(13,13,13,0.36)] px-5 py-5 backdrop-blur-sm"
            >
              <dt className="font-label text-[10px] uppercase tracking-[0.22em] text-[#d0c5af]/48">
                {metric.label}
              </dt>
              <dd className="mt-3 font-headline text-[2.35rem] font-bold leading-[0.92] text-[#f2ca50] md:text-[2.75rem]">
                {metric.value}
              </dd>
              <div className="mt-2 text-xs text-[#d0c5af]/62">
                {metric.note}
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
