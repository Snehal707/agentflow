import type { ReactNode } from "react";

type ChatTopNavbarProps = {
  actions: ReactNode;
};

export function ChatTopNavbar({ actions }: ChatTopNavbarProps) {
  return (
    <header className="flex h-20 flex-shrink-0 min-w-0 items-center justify-end overflow-hidden border-b border-white/5 bg-[#080808]/90 px-6 xl:px-10 backdrop-blur-xl shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
      <div className="flex flex-shrink-0 items-center gap-4">
        {actions}
      </div>
    </header>
  );
}
