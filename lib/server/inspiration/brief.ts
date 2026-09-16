import { VISUAL_FORMATS } from "../creative/formats";
import { reviewCopy, scaffoldVariants } from "../copywriting";
import type { DirectionBriefPack } from "../../direction-brief";
import type { InspirationSearchPack } from "../../inspiration-pack";

const BRIEF_FORMATS = ["ig_feed_4x5", "ig_story", "poster_a4"] as const;

function detectKind(text: string) {
  if (/社博|攤位|文館/.test(text)) return "fair" as const;
  if (/茶會/.test(text)) return "tea" as const;
  if (/演講|講座/.test(text)) return "talk" as const;
  return "generic" as const;
}

export function compileDirectionBrief(input: {
  pack: InspirationSearchPack;
  selected: "A" | "B" | "C";
}): DirectionBriefPack {
  const direction = input.pack.directions.find(
    (item) => item.id === input.selected,
  );
  if (!direction)
    throw new Error("missing_direction");
  const kind = detectKind(
    [input.pack.query.primary, direction.title, direction.summary].join("\n"),
  );
  const scaffold = scaffoldVariants({
    channel: "ig_caption",
    kind,
    facts: {},
  });
  const review = reviewCopy({
    channel: "ig_caption",
    title: direction.title,
    variants: scaffold.variants,
  });
  return {
    kind: "direction_brief",
    selected: input.selected,
    title: direction.title,
    summary: direction.summary,
    hermesGenerated: false,
    rendered: false,
    generatedImage: false,
    publish: false,
    formats: BRIEF_FORMATS.map((id) => {
      const format = VISUAL_FORMATS[id];
      return {
        id: format.id,
        label: format.label,
        aspect: format.aspect,
        width: format.width,
        height: format.height,
        compositionHint: format.compositionHint,
      };
    }),
    copy: scaffold.variants,
    review,
    notice:
      "這是依已選方向整理的文案與視覺規格。不是 Hermes 生成、不是已出圖、不是已發佈。日期地點未確認標 UNKNOWN。",
  };
}
