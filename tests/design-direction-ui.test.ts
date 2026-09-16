import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { designFromResult, isCanvaDesign } from "../lib/client/design-result";
import {
  directionFollowUp,
  isDirectionSet,
} from "../lib/client/direction-result";
import { shortMaterialTitle } from "../lib/client/image-critique";

test("chat shows direction picks and Canva previews, not tool JSON", async () => {
  const workflow = {
    id: "ui-fixture-artifact-B",
    state: "awaiting_selection",
    selected: null,
    brief: "淡江新生茶會",
    directions: [
      { title: "校園生活", claim: "用走路上學的畫面" },
      { title: "茶桌近拍", claim: "先看到茶再看到社團" },
      { title: "同學一起坐", claim: "低門檻見面" },
    ],
  };
  assert.equal(isDirectionSet(workflow), true);
  assert.equal(
    isDirectionSet({
      fullSiteSearch: false,
      instagramConnected: false,
      notice: "x",
      visualLanguage: { keep: [] },
    }),
    false,
  );
  const design = {
    id: "contract_design",
    title: "茶會草稿",
    urls: { edit_url: "https://www.canva.com/design/contract_design/edit" },
    thumbnail: { url: "https://www.canva.com/ui-fixture-preview.png" },
  };
  assert.equal(isCanvaDesign(design), true);
  assert.equal(
    isCanvaDesign({ url: "https://example.com/not-canva" }),
    false,
  );
  const nested = designFromResult({
    id: workflow.id,
    state: "draft_ready",
    design,
  });
  assert.equal(nested?.artifactId, workflow.id);
  assert.equal(nested?.design.title, "茶會草稿");
  assert.match(directionFollowUp(workflow.id, 1, "茶桌近拍"), /不要另起無關作品/);
  assert.equal(
    shortMaterialTitle("2026FreshmanWelcomeCampaignReferenceVersionFinal.png")
      .endsWith("…"),
    true,
  );
  const ui = await readFile(
    new URL("../components/visual/VisualMessage.tsx", import.meta.url),
    "utf8",
  );
  const pick = await readFile(
    new URL("../components/visual/DirectionPick.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /DirectionPick/);
  assert.match(ui, /ArtifactStage/);
  assert.match(pick, /用這個方向/);
  assert.match(pick, /選定後才會製作，不是已發佈/);
  assert.doesNotMatch(pick, /toolCallId|inputSchema|credentialReference/);
  assert.doesNotMatch(ui, /traceId|credentialReference/);
});
