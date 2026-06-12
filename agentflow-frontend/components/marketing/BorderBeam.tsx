"use client";

import React from "react";

interface BorderBeamProps {
  className?: string;
  duration?: number;
  size?: number;
}

export function BorderBeam({
  className = "",
  duration = 6,
  size = 80,
}: BorderBeamProps) {
  return (
    <div className={`absolute inset-0 pointer-events-none rounded-[inherit] z-30 ${className}`}>
      <svg className="absolute inset-0 w-full h-full rounded-[inherit]" fill="none">
        <rect
          x="0.5"
          y="0.5"
          width="calc(100% - 1px)"
          height="calc(100% - 1px)"
          rx="inherit"
          ry="inherit"
          className="stroke-[2.5px] [stroke-linecap:round]"
          stroke="url(#border-beam-grad)"
          strokeDasharray={`${size} 320`}
          pathLength="400"
          style={{
            animation: `afBorderBeam ${duration}s linear infinite`,
          }}
        />
        <defs>
          <linearGradient id="border-beam-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f2ca50" stopOpacity="1" />
            <stop offset="40%" stopColor="#fbbf24" stopOpacity="0.5" />
            <stop offset="80%" stopColor="#d97706" stopOpacity="0" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
