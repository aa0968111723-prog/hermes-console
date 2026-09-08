import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-cycle18-fork-audience-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3218";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
delete process.env.CONSOLE_GATEWAY_SECRET;
process.env.CONSOLE_REQUIRE_GATEWAY = "false";

const { put, get } = await import("../lib/server/store");
const conversations = await import("../app/api/conversations/route");
const { buildProfile } = await import("../lib/server/audience/engine");
const { debateFromEvaluations } = await import("../lib/server/audience/debate");
const { evaluateArtifact } = await import("../lib/server/audience/evaluation");
const { heuristicScores } = await import("../lib/server/audience/scoring");
const {
  appliesReligiousDistance,
  rankingWeights,
  weightedScore,
  rankDirections,
} = await import("../lib/server/creative/ranking");
const audienceRoute = await import("../app/api/audience/route");

function request(path: string, body: unknown) {
  return new Request("http://localhost:3218/api/" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: JSON.stringify(body),
  });
}

function parentConversation() {
  const now = new Date().toISOString();
  const messages = [
    {
      id: randomUUID(),
      role: "user" as const,
      content: "第一則",
      createdAt: now,
      taskId: "parent-task",
    },
    {
      id: randomUUID(),
      role: "assistant" as const,
      content: "第二則",
      createdAt: now,
    },
    {
      id: randomUUID(),
      role: "user" as const,
      content: "第三則",
      createdAt: now,
    },
  ];
  const id = randomUUID();
  put("conversation", "workspace", {
    id,
    title: "父對話",
    projectId: "personal",
    messages,
    hermesSessionId: null,
    createdAt: now,
    updatedAt: now,
  });
  return { id, messages };
}

test("Cycle 18: omit beforeMessageId forks full parent; slice only when set; bad id is 400", async () => {
  const parent = parentConversation();
  const full = await conversations.POST(
    request("conversations", {
      title: "完整分支",
      parentId: parent.id,
    }),
  );
  assert.equal(full.status, 201);
  const fullBody = await full.json();
  assert.equal(fullBody.conversation.parentId, parent.id);
  assert.equal(fullBody.conversation.messages.length, 3);
  assert.deepEqual(
    fullBody.conversation.messages.map((m: { content: string }) => m.content),
    ["第一則", "第二則", "第三則"],
  );
  assert.equal(
    fullBody.conversation.messages.some(
      (m: { id: string }) => parent.messages.some((p) => p.id === m.id),
    ),
    false,
  );
  assert.equal(fullBody.conversation.messages[0].taskId, undefined);
  const storedParent = get<{ messages: { content: string }[] }>(
    "conversation",
    "workspace",
    parent.id,
  );
  assert.equal(storedParent?.messages.length, 3);

  const sliced = await conversations.POST(
    request("conversations", {
      title: "切點分支",
      parentId: parent.id,
      beforeMessageId: parent.messages[2].id,
    }),
  );
  assert.equal(sliced.status, 201);
  const slicedBody = await sliced.json();
  assert.deepEqual(
    slicedBody.conversation.messages.map((m: { content: string }) => m.content),
    ["第一則", "第二則"],
  );

  const missing = await conversations.POST(
    request("conversations", {
      title: "錯誤切點",
      parentId: parent.id,
      beforeMessageId: randomUUID(),
    }),
  );
  assert.equal(missing.status, 400);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, "message_not_found");
});

test("Cycle 18: debate consensus is generalized, not freshman day-one copy", () => {
  const alumni = buildProfile({
    projectId: "personal",
    institution: "國立成功大學",
    location: "台南",
    name: "校友企業主管",
    ageRange: "35–55",
    lifeStage: "alumni-executive",
  });
  const debate = debateFromEvaluations(
    evaluateArtifact({
      profile: alumni,
      title: "企業贊助說明會",
      copy: "週五晚上來參加校友交流。",
    }),
  );
  const blob = JSON.stringify(debate.consensus);
  assert.equal(blob.includes("大一立刻懂"), false);
  assert.equal(blob.includes("大一"), false);
  assert.ok(debate.consensus.some((item) => item.includes("目標受眾")));
  assert.ok(debate.consensus.some((item) => item.includes("時間地點清楚")));
});

test("Cycle 18: buildProfile accepts ageRange and lifeStage overrides", async () => {
  const freshman = buildProfile({
    projectId: "personal",
    institution: "淡江大學",
    location: "淡水",
    name: "淡江大一新生",
  });
  assert.equal(freshman.ageRange, "18–19");
  assert.equal(freshman.lifeStage, "university-entry");

  const exec = buildProfile({
    projectId: "personal",
    institution: "國立成功大學",
    location: "台南",
    name: "EMBA 企業高階主管",
    ageRange: "35–55",
    lifeStage: "alumni-executive",
  });
  assert.equal(exec.ageRange, "35–55");
  assert.equal(exec.lifeStage, "alumni-executive");
  assert.equal(exec.description.includes("大一生活轉換期"), false);
  assert.ok(exec.description.includes("EMBA 企業高階主管"));

  const api = await audienceRoute.POST(
    request("audience", {
      action: "profile",
      institution: "國立成功大學",
      location: "台南",
      label: "銀髮樂齡學員",
      ageRange: "60–75",
      lifeStage: "lifelong-learning",
    }),
  );
  assert.equal(api.status, 200);
  const json = await api.json();
  assert.equal(json.profile.ageRange, "60–75");
  assert.equal(json.profile.lifeStage, "lifelong-learning");
  assert.equal(json.profile.ageRange === "18–19", false);
  assert.equal(json.profile.lifeStage === "university-entry", false);
});

test("Cycle 18: religiousDistance ranking applies only to religious or zen projects", () => {
  for (const secular of ["熱舞社", "吉他社", "黑客松", "成大醫學系", ""]) {
    assert.equal(appliesReligiousDistance(secular), false, secular);
    assert.equal("religiousDistance" in rankingWeights(secular), false, secular);
  }
  assert.equal(appliesReligiousDistance("禪學社"), true);
  assert.equal(appliesReligiousDistance({ club: "佛學社" }), true);
  assert.equal(appliesReligiousDistance({ project: "tku-zen-agent" }), true);
  assert.equal("religiousDistance" in rankingWeights("禪學社"), true);

  const base = heuristicScores({
    copy: "週五晚上來參加迎新",
    audienceLocation: "台南",
    audienceInstitution: "成功大學",
  }).scores;
  const low = { ...base, religiousDistance: 18 };
  const high = { ...base, religiousDistance: 74 };
  assert.equal(weightedScore(low), weightedScore(high));
  assert.equal(weightedScore(low, "熱舞社"), weightedScore(high, "熱舞社"));
  assert.ok(weightedScore(low, "禪學社") > weightedScore(high, "禪學社"));

  const direction = {
    title: "迎新",
    claim: "找朋友",
    visual: "校園",
    copy: "週五晚上來參加迎新",
    cta: "來",
  };
  const secularRank = rankDirections({
    directions: [direction],
    scores: [high],
    club: "熱舞社",
  });
  const zenRank = rankDirections({
    directions: [direction],
    scores: [high],
    club: "禪學社",
  });
  assert.ok(secularRank.ranking[0].score > zenRank.ranking[0].score);
});
