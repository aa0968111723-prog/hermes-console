"use client";

export type AppearancePreferences = {
  font: number;
  width: number;
  compact: boolean;
  turtle: boolean;
  animation: boolean;
  turtleSize: number;
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  font: 16,
  width: 780,
  compact: false,
  turtle: true,
  animation: true,
  turtleSize: 100,
};

export default function AppearanceSettings({
  prefs,
  onChange,
  onReset,
}: {
  prefs: AppearancePreferences;
  onChange: (next: AppearancePreferences) => void;
  onReset: () => void;
}) {
  return (
    <div className="settings-stack">
      <p className="muted">固定明亮介面。外觀偏好只儲存在此瀏覽器。</p>
      <label>
        文字大小
        <select
          value={prefs.font}
          onChange={(e) =>
            onChange({ ...prefs, font: Number(e.target.value) })
          }
        >
          {[14, 16, 18, 20].map((n) => (
            <option key={n} value={n}>
              {n} px
            </option>
          ))}
        </select>
      </label>
      <label>
        閱讀寬度
        <select
          value={prefs.width}
          onChange={(e) =>
            onChange({ ...prefs, width: Number(e.target.value) })
          }
        >
          {[680, 780, 920].map((n) => (
            <option key={n} value={n}>
              {n} px
            </option>
          ))}
        </select>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={prefs.compact}
          onChange={(e) =>
            onChange({ ...prefs, compact: e.target.checked })
          }
        />
        緊湊訊息間距
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={prefs.turtle}
          onChange={(e) =>
            onChange({ ...prefs, turtle: e.target.checked })
          }
        />
        顯示龜龜
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={prefs.animation}
          onChange={(e) =>
            onChange({ ...prefs, animation: e.target.checked })
          }
        />
        輕柔動畫（尊重系統減少動畫設定）
      </label>
      <label>
        龜龜大小
        <select
          value={prefs.turtleSize}
          onChange={(e) =>
            onChange({ ...prefs, turtleSize: Number(e.target.value) })
          }
        >
          {[72, 100, 128].map((n) => (
            <option key={n} value={n}>
              {n} px
            </option>
          ))}
        </select>
      </label>
      <button onClick={onReset}>重設外觀</button>
    </div>
  );
}
