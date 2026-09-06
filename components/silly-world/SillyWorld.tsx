"use client";

import {
  FormEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { copy } from "@/lib/silly-copy";
import "./silly-world.css";

type OrbId = "water" | "light" | "fire" | "forest";

const ORBS: { id: OrbId; label: string; tip: string }[] = [
  { id: "water", label: copy.orbLabels.water, tip: "流動的故事線" },
  { id: "light", label: copy.orbLabels.light, tip: "閃亮的轉折" },
  { id: "fire", label: copy.orbLabels.fire, tip: "燃起高潮場面" },
  { id: "forest", label: copy.orbLabels.forest, tip: "角色與世界觀" },
];

const PROJECTS = [...copy.projects];

export default function SillyWorld() {
  const [project, setProject] = useState(PROJECTS[0]);
  const [projectOpen, setProjectOpen] = useState(false);
  const [selected, setSelected] = useState<OrbId | null>("water");
  const [draft, setDraft] = useState("");
  // string, not typeof copy.greeting — wand / ack set other phrases (TS2345).
  const [greeting, setGreeting] = useState<string>(copy.greeting);
  const [flying, setFlying] = useState(false);
  const [panel, setPanel] = useState<"palette" | "star" | "wand" | null>(null);
  const [burst, setBurst] = useState(0);
  const composing = useRef(false);

  const selectedOrb = useMemo(() => ORBS.find((o) => o.id === selected) ?? null, [selected]);

  function send(e?: FormEvent) {
    e?.preventDefault();
    if (composing.current) return;
    const text = draft.trim();
    if (!text || flying) return;
    setFlying(true);
    window.setTimeout(() => {
      setGreeting(copy.greetingAck);
      setDraft("");
      setFlying(false);
      setBurst((n) => n + 1);
      window.setTimeout(() => setGreeting(copy.greeting), 1600);
    }, 520);
  }

  function tapOrb(id: OrbId) {
    setSelected((cur) => (cur === id ? null : id));
    setBurst((n) => n + 1);
  }

  return (
    <div className="silly-world-root">
      <div className="phone">
        <div className="parchment" data-burst={burst}>
          <header className="top">
            <Link href="/" className="flower" aria-label="回控制台" style={{ textDecoration: "none" }}>
              ✿
            </Link>
            <h1>
              <span className="leaf" aria-hidden>
                ❧
              </span>
              {copy.appTitle}
              <span className="leaf" aria-hidden>
                ❧
              </span>
            </h1>
            <button className="face" type="button" aria-label="角色心情" onClick={() => setBurst((n) => n + 1)}>
              ◡̈
            </button>
          </header>

          <div className="stars-divider" aria-hidden>
            ✦ ✦ ✦
          </div>

          <div className="prompt-row">
            <span className="chat-icon" aria-hidden>
              💬
            </span>
            <div className="speech">
              {greeting}
              <span className="heart">♡</span>
            </div>
          </div>

          <p className="local-note">本地舞台，尚未接上真實生成。</p>

          <div className="stage">
            <div className="orbs">
              {ORBS.map((orb, i) => (
                <button
                  key={orb.id}
                  type="button"
                  className={`sw-orb sw-orb-${orb.id} ${selected === orb.id ? "active" : ""}`}
                  style={{ ["--enter-delay" as string]: `${i * 0.12}s` } as CSSProperties}
                  onClick={() => tapOrb(orb.id)}
                  aria-pressed={selected === orb.id}
                  title={orb.tip}
                  aria-label={copy.orbA11y(orb.label)}
                >
                  <span className="sw-orb-core" />
                  <span className="spark s1" />
                  <span className="spark s2" />
                  <span className="spark s3" />
                </button>
              ))}
            </div>

            <div className="hero" aria-hidden>
              <div className="hero-body">
                <div className="hair" />
                <div className="face-dot" />
                <div className="shirt" />
                <div className="shorts" />
                <div className="bag" />
                <div className="leg l" />
                <div className="leg r" />
              </div>
            </div>
          </div>

          {panel && (
            <div className="panel" role="dialog">
              <p>
                {panel === "palette" && "調色：把靈感染成粉彩氛圍"}
                {panel === "star" && `星星：收藏${selectedOrb?.label ?? "這一球"}的靈感種子`}
                {panel === "wand" && "魔杖：突然出現一顆會說話的元素球！"}
              </p>
              <button type="button" onClick={() => setPanel(null)}>
                收起
              </button>
            </div>
          )}

          <footer className="dock">
            <div className="project-wrap">
              <button type="button" className="project" onClick={() => setProjectOpen((v) => !v)} aria-expanded={projectOpen}>
                <span className="layers" aria-hidden>
                  ▤
                </span>
                {copy.projectLabel}
                <span className="caret">▾</span>
              </button>
              {projectOpen && (
                <ul className="project-menu">
                  {PROJECTS.map((p) => (
                    <li key={p}>
                      <button
                        type="button"
                        className={p === project ? "on" : ""}
                        onClick={() => {
                          setProject(p);
                          setProjectOpen(false);
                        }}
                      >
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form className="composer" onSubmit={send}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={copy.inputPlaceholder}
                aria-label="靈感輸入"
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
              />
              <button type="submit" className={`send ${flying ? "fly" : ""}`} aria-label={copy.sendA11y} disabled={!draft.trim() || flying}>
                ✈
              </button>
            </form>

            <div className="actions">
              <button type="button" className="act green" aria-label="調色盤" onClick={() => setPanel(panel === "palette" ? null : "palette")}>
                🎨
              </button>
              <button type="button" className="act yellow" aria-label="星星" onClick={() => setPanel(panel === "star" ? null : "star")}>
                ★
              </button>
              <button
                type="button"
                className="act purple"
                aria-label="魔杖"
                onClick={() => {
                  setPanel("wand");
                  setGreeting("突然出現一顆會說話的元素球！");
                  setBurst((n) => n + 1);
                  window.setTimeout(() => setGreeting(copy.greeting), 1800);
                }}
              >
                🪄
              </button>
            </div>
            <p className="project-label">{project}</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
