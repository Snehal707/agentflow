"use client";

type SidebarToggleButtonProps = {
  collapsed: boolean;
  onClick: () => void;
  className?: string;
};

export function SidebarToggleButton({
  collapsed,
  onClick,
  className = "",
}: SidebarToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
      aria-pressed={!collapsed}
      title={collapsed ? "Open sidebar" : "Close sidebar"}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#131313] text-white/40 hover:border-[rgba(242,202,80,0.35)] hover:bg-white/5 hover:text-white/80 transition-all duration-150 active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(242,202,80,0.55)] focus-visible:outline-offset-2 ${className}`.trim()}
    >
      <span className="material-symbols-outlined text-[20px]">
        {collapsed ? "left_panel_open" : "left_panel_close"}
      </span>
    </button>
  );
}
