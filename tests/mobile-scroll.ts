import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

/**
 * Prove the nested workspace scrollport owns overflow. Document scroll is not
 * the mobile page model; a probe taller than the viewport must move the
 * conversation/secondary scroller, then be removed.
 */
export async function verifyScrollOwnership(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const main = document.querySelector(".workspace-main");
    const chat = document.querySelector(".conversation-scroll");
    const secondary = document.querySelector(".secondary-page");
    const port = chat || secondary;
    const dock = document.querySelector(".spatial-dock");
    if (!shell || !main || !port) return null;
    const shellStyle = getComputedStyle(shell);
    const mainStyle = getComputedStyle(main);
    const portStyle = getComputedStyle(port);
    const dockStyle = dock ? getComputedStyle(dock) : null;
    return {
      shellOverflow: shellStyle.overflow,
      mainOverflow: mainStyle.overflow,
      mainTransform: mainStyle.transform,
      portOverflowY: portStyle.overflowY,
      portFlex: `${portStyle.flexGrow} ${portStyle.flexShrink} ${portStyle.flexBasis}`,
      dockPosition: dockStyle?.position || "none",
      dockDisplay: dockStyle?.display || "none",
    };
  });
  assert.ok(metrics, `${label}: missing shell/main/scrollport`);
  assert.equal(metrics.shellOverflow, "hidden", `${label}: shell must clip, not scroll`);
  assert.equal(metrics.mainOverflow, "hidden", `${label}: main must contain the flex scrollport`);
  assert.equal(metrics.mainTransform, "none", `${label}: do not transform the scroll ancestor`);
  assert.match(metrics.portOverflowY, /auto|scroll/, `${label}: nested port must scroll`);
  if (metrics.dockDisplay !== "none") {
    assert.equal(metrics.dockPosition, "fixed", `${label}: dock must be viewport-fixed`);
  }

  const result = await page.evaluate(() => {
    const port = (document.querySelector(".conversation-scroll") ||
      document.querySelector(".secondary-page")) as HTMLElement | null;
    if (!port) return { ok: false, reason: "missing-port" };
    const probe = document.createElement("div");
    probe.id = "hermes-scroll-probe";
    probe.setAttribute("aria-hidden", "true");
    probe.style.height = "2200px";
    probe.style.flex = "none";
    probe.style.pointerEvents = "none";
    port.appendChild(probe);
    const beforeDoc = document.documentElement.scrollTop;
    const beforeBody = document.body.scrollTop;
    const beforePort = port.scrollTop;
    port.scrollTop = 480;
    const afterPort = port.scrollTop;
    const afterDoc = document.documentElement.scrollTop;
    const client = port.clientHeight;
    const scroll = port.scrollHeight;
    probe.remove();
    port.scrollTop = beforePort;
    return {
      ok: true,
      beforeDoc,
      beforeBody,
      afterPort,
      afterDoc,
      client,
      scroll,
    };
  });
  assert.equal(result.ok, true, `${label}: scrollport missing`);
  assert.ok(
    (result.scroll ?? 0) > (result.client ?? 0) + 400,
    `${label}: probe must make the nested port taller than its box`,
  );
  assert.ok((result.afterPort ?? 0) >= 400, `${label}: nested port must accept scrollTop`);
  assert.equal(result.afterDoc ?? 0, 0, `${label}: document must not become the scroller`);
}
