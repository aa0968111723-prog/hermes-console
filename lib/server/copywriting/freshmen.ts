import type { CopyLintIssue, CopyPersonaReview } from "./types";

export const FRESHMAN_TWINS = [
  {
    id: "dorm",
    label: "剛搬來淡水的住宿新生",
    needs: ["地點好找", "晚上回宿舍方便"],
  },
  {
    id: "commute",
    label: "每天通勤的新生",
    needs: ["結束時間", "趕捷運"],
  },
  {
    id: "shy",
    label: "內向、怕尷尬的新生",
    needs: ["來坐一下就好", "不用表演"],
  },
  {
    id: "friends",
    label: "想交朋友的新生",
    needs: ["會認識人", "低門檻見面"],
  },
  {
    id: "religion_fear",
    label: "想參加社團但怕太宗教的新生",
    needs: ["不像宣教", "先講在做什麼"],
  },
  {
    id: "curious_zen",
    label: "對禪有興趣但不了解的新生",
    needs: ["術語有人翻譯", "體驗不是考試"],
  },
  {
    id: "activity_only",
    label: "對禪完全沒興趣、只想找活動的新生",
    needs: ["茶會／遊戲／攤位", "不是上課"],
  },
  {
    id: "improve",
    label: "想提升自己的人",
    needs: ["具體可帶走的東西", "不是口號"],
  },
  {
    id: "stressed",
    label: "課業壓力高的人",
    needs: ["大腦休息", "時間負擔低"],
  },
  {
    id: "lost",
    label: "覺得自己還不知道大學要做什麼的人",
    needs: ["來看看就好", "不用先決定入社"],
  },
] as const;

function has(text: string, pattern: RegExp) {
  return pattern.test(text);
}

export function evaluateFreshmen(input: {
  text: string;
  lint: CopyLintIssue[];
  hasTimePlace: boolean;
  hasCta: boolean;
  locationUnknown: boolean;
}): CopyPersonaReview[] {
  const text = input.text;
  const jargon = input.lint.some((item) => item.kind === "jargon");
  const religious = input.lint.some((item) => item.kind === "religious");
  const preachy = input.lint.some((item) => item.kind === "preachy");
  const life = has(text, /朋友|茶會|社博|攤位|淡水|克難坡|坐一下|手搖/);
  const lowPressure = has(text, /來坐|看看就好|不用|沒有考試|沒有壓力|路過也可以/);
  const rest = has(text, /休息|大腦|放鬆|課業|期中/);
  const explain = has(text, /不是宗教|先體驗|靜下來|認識自己|專注/);

  return FRESHMAN_TWINS.map((twin) => {
    const locationGap = input.locationUnknown && (twin.id === "dorm" || twin.id === "commute");
    const timeGap = !input.hasTimePlace && twin.id === "commute";
    const scared =
      (twin.id === "religion_fear" || twin.id === "shy") &&
      (religious || (jargon && !life));
    const skipZen = twin.id === "activity_only" && jargon && !life;
    const understands = !jargon || life || explain;
    const wouldStop =
      (life || rest || lowPressure) && !scared && !skipZen && !locationGap;
    const pressure = !lowPressure && (preachy || has(text, /入社|蛻變|改變自己/));
    const wouldWalkIn = wouldStop && understands && !pressure && !locationGap;
    const wouldFillForm =
      wouldWalkIn && input.hasCta && !timeGap && !input.locationUnknown;

    const questions: string[] = [];
    if (locationGap) questions.push("地點還沒定，我怎麼決定要不要出門？");
    if (timeGap) questions.push("幾點結束？趕不趕得上末班車？");
    if (scared) questions.push("這會不會其實是宗教活動？");
    if (twin.id === "shy") questions.push("我可以只坐著聽嗎？會不會被點名？");
    if (skipZen) questions.push("這跟我想找的活動有什麼關係？");
    if (twin.id === "lost" && !lowPressure)
      questions.push("我還沒想好要不要入社，可以先來看看嗎？");

    let firstReaction = "還行，但再滑一下也可能走。";
    if (scared) firstReaction = "有點像在傳教，先滑掉。";
    else if (skipZen) firstReaction = "看不懂在做什麼，不是我要的活動。";
    else if (locationGap) firstReaction = "地點不明，先存著以後再說。";
    else if (twin.id === "stressed" && rest)
      firstReaction = "如果真的能讓腦子停一下，我願意看完。";
    else if (twin.id === "friends" && life)
      firstReaction = "聽起來可以認識人，比較想去。";
    else if (twin.id === "shy" && lowPressure)
      firstReaction = "寫說來坐一下，比較敢點進去。";
    else if (!understands) firstReaction = "主標看不懂，我不會停。";

    return {
      id: twin.id,
      label: twin.label,
      firstReaction,
      wouldStop,
      pressure,
      understands,
      wouldFillForm,
      wouldWalkIn,
      questions,
    };
  });
}
