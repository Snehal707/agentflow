"use client";

import Link from "next/link";

type BrandVariant = "sidebar" | "nav" | "footer";

type BrandLockupProps = {
  href?: string;
  collapsed?: boolean;
  variant?: BrandVariant;
  className?: string;
};

const variantClasses: Record<BrandVariant, { gap: string; badge: string; wordmark: string }> = {
  sidebar: {
    gap: "gap-3",
    badge: "h-11 w-11 rounded-[14px]",
    wordmark: "text-[2rem]",
  },
  nav: {
    gap: "gap-2.5",
    badge: "h-10 w-10 rounded-[13px]",
    wordmark: "text-[1.6rem]",
  },
  footer: {
    gap: "gap-2.5",
    badge: "h-10 w-10 rounded-[13px]",
    wordmark: "text-[1.4rem]",
  },
};

function BrandContent({
  collapsed = false,
  variant = "sidebar",
}: Pick<BrandLockupProps, "collapsed" | "variant">) {
  const styles = variantClasses[variant];

  return (
    <div className={`inline-flex items-center ${styles.gap}`}>
      <div
        className={`relative grid place-items-center border border-white/10 bg-[#101010] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${styles.badge}`}
      >
        <span className="text-[1.15rem] font-black tracking-[-0.08em] leading-none">
          <span className="text-[#f2ca50]">A</span>
          <span className="text-white/85">F</span>
        </span>
        <span className="absolute bottom-[7px] left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-[#f2ca50]/80" />
      </div>

      {collapsed ? null : (
        <span
          className={`font-headline font-black tracking-[-0.05em] leading-none text-white ${styles.wordmark}`}
        >
          Agent<span className="text-[#f2ca50]">Flow</span>
        </span>
      )}
    </div>
  );
}

export function BrandLockup({
  href,
  collapsed = false,
  variant = "sidebar",
  className = "",
}: BrandLockupProps) {
  const content = <BrandContent collapsed={collapsed} variant={variant} />;
  const classes = `inline-flex items-center ${className}`.trim();

  if (href) {
    return (
      <Link href={href} className={classes} aria-label="AgentFlow">
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}
