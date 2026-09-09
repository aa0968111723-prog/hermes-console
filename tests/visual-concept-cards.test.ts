import test from "node:test";
import assert from "node:assert/strict";
import {
  isVisualConceptPack,
  parseVisualConceptPack,
} from "../lib/client/visual-pack";

const pack = {
  title: "迎新茶會",
  notice: "活動資訊不完整（日期、地點）。已標 UNKNOWN，沒有補造，也沒有出圖。",
  generatedImage: false as const,
  rendered: false as const,
  publish: false as const,
  format: {
    id: "ig_feed_4x5",
    label: "Instagram 貼文 4:5",
    width: 1080,
    height: 1350,
    aspect: "4:5",
  },
  unknownFields: ["日期", "地點"],
  concepts: [
    { id: "A" as const, name: "攝影感校園生活", creativeDirection: "光影", background: "白天", visualHierarchy: ["場景"], generatedImage: false as const, rendered: false as const },
    { id: "B" as const, name: "物件敘事", creativeDirection: "小物", background: "桌面", visualHierarchy: ["物件"], generatedImage: false as const, rendered: false as const },
    { id: "C" as const, name: "空間與聚集", creativeDirection: "廣場", background: "空氣", visualHierarchy: ["空間"], generatedImage: false as const, rendered: false as const },
  ],
};

test("visual pack guard rejects fake renders and incomplete concepts", () => {
  assert.equal(isVisualConceptPack(pack), true);
  assert.equal(isVisualConceptPack({ ...pack, generatedImage: true }), false);
  assert.equal(isVisualConceptPack({ ...pack, publish: true }), false);
  assert.equal(isVisualConceptPack({ ...pack, concepts: pack.concepts.slice(0, 2) }), false);
  assert.equal(parseVisualConceptPack(JSON.stringify(pack))?.format.width, 1080);
  assert.equal(parseVisualConceptPack("請幫我做海報"), null);
  assert.equal(parseVisualConceptPack("{not json"), null);
});
