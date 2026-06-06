import type { ReactNode } from "react";

type ChatTopNavbarProps = {
  actions: ReactNode;
};

export function ChatTopNavbar({ actions }: ChatTopNavbarProps) {
  return (
    <header className="flex h-[104px] flex-shrink-0 min-w-0 items-center justify-end overflow-hidden border-b border-white/5 bg-[#080808]/95 px-6 shadow-[0_22px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl xl:px-10">
      <div className="flex flex-shrink-0 items-center gap-4">{actions}</div>
    </header>
  );
}
