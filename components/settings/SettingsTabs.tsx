"use client";

const TABS = ["帳號", "外觀", "連線", "工作區", "進階"] as const;
export type SettingsTab = (typeof TABS)[number];

export default function SettingsTabs({
  value,
  onChange,
}: {
  value: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}) {
  return (
    <div
      className="setting-tabs"
      role="tablist"
      aria-label="設定分類"
      onKeyDown={(event) => {
        if (
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        )
          return;
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]',
          ),
        );
        const index = tabs.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (index +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  tabs.length) %
                tabs.length;
        event.preventDefault();
        tabs[next]?.focus();
        tabs[next]?.click();
      }}
    >
      {TABS.map((tab) => (
        <button
          key={tab}
          role="tab"
          id={"setting-tab-" + tab}
          aria-controls="setting-panel"
          aria-selected={value === tab}
          tabIndex={value === tab ? 0 : -1}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
