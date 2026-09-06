import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MOBILE_BREAKPOINT_PX,
  MOBILE_CREATIVE_PANES,
} from "../lib/client/mobile-workspace.ts";

test("Phase 11 simplified mobile creative workspace", async (t) => {
  await t.test("mobile panes are brief, design, copy, audience", () => {
    assert.equal(MOBILE_BREAKPOINT_PX, 760);
    assert.deepEqual(
      MOBILE_CREATIVE_PANES.map((pane) => pane.id),
      ["brief", "design", "copy", "audience"],
    );
  });

  await t.test("CSS stacks the composer and uses 44px tap targets under 760px", async () => {
    const css = await readFile(join(process.cwd(), "app/globals.css"), "utf8");
    assert.ok(css.includes("@media (max-width: 760px)"));
    assert.ok(css.includes(".os-query-box"));
    assert.ok(css.includes("flex-direction: column"));
    assert.ok(css.includes("min-height: 44px"));
    assert.ok(css.includes(".mobile-pane-tabs"));
    assert.ok(css.includes(".mobile-pane.is-active"));
  });

  await t.test("Creative OS view has mobile pane tabs and short titles", async () => {
    const view = await readFile(
      join(process.cwd(), "components/CreativeIntelligenceView.tsx"),
      "utf8",
    );
    assert.ok(view.includes("mobile-pane-tabs"));
    assert.ok(view.includes("hero-title-short"));
    assert.ok(view.includes("os-integration-status-row"));
    const consoleUi = await readFile(
      join(process.cwd(), "components/HermesConsole.tsx"),
      "utf8",
    );
    assert.ok(consoleUi.includes("nav-label-short"));
  });
});
