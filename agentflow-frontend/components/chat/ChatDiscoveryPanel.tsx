"use client";

type ChatDiscoveryPanelProps<T extends string> = {
  quickActions: ReadonlyArray<{ label: string; tab: T }>;
  selectedTab: T;
  onSelectTab: (tab: T) => void;
  suggestions: string[];
  onSuggestion: (value: string) => void;
};

export function ChatDiscoveryPanel<T extends string>({
  quickActions,
  selectedTab,
  onSelectTab,
  suggestions,
  onSuggestion,
}: ChatDiscoveryPanelProps<T>) {
  return (
    <div className="mt-10 w-full">
      <div className="mb-5 flex flex-wrap gap-2">
        {quickActions.map((action) => {
          const active = action.tab === selectedTab;
          return (
            <button
              key={action.label}
              type="button"
              onClick={() => onSelectTab(action.tab)}
              className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-all duration-150 ${
                active
                  ? "border-[rgba(242,202,80,0.45)] bg-[rgba(242,202,80,0.12)] text-[#f2ca50]"
                  : "border-white/10 bg-[#1c1b1b] text-white/60 hover:text-white/90"
              }`}
            >
              {action.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {suggestions.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onSuggestion(item)}
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-[#1c1b1b] px-4 py-4 text-left text-sm text-white/70 transition-all duration-150 hover:bg-[#201f1f] hover:text-white active:scale-[0.99]"
          >
            <span>{item}</span>
            <span className="text-[#f2ca50]">{"->"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
