import type { AudienceDomain } from "../audience-twin/engine.ts";

export interface RawDirection {
  id: string;
  title: string;
  subtitle: string;
  hook: string;
  coreInsight: string;
  visualConcept: string;
  colorPalette: { name: string; hex: string }[];
}

export interface DomainSocialLogistics {
  badgeContent: string;
  eventLogistics: string;
  hashtags: string[];
}

export const TAMKANG_DIRECTIONS: RawDirection[] = [
  {
    id: "dir_kenan_recharge",
    title: "克難坡登頂後的 15 分鐘心靈茶席",
    subtitle: "腿酸先歇會兒・大腦瞬間重開機",
    hook: "到底誰發明了 132 階克難坡？爬上來的大一新生，這杯冷泡茶我們請你喝。",
    coreInsight: "大一開學最普遍的生理與心理痛點就是通勤爬坡。將『體能疲累』直接轉化為『放下重擔進來喝茶』的共鳴情境，無說教感。",
    visualConcept: "日系戶外雜誌風格。畫面以淡水晨光、克難坡綠意階梯與手作陶茶碗為視覺重心，右下角點綴 36px 手作圓形三色光小印章，留白通透。",
    colorPalette: [
      { name: "靜謐深竹綠", hex: "#2E4036" },
      { name: "溫潤米紙白", hex: "#F7F5EE" },
      { name: "陶土茶韻褐", hex: "#C29B7F" },
      { name: "朝陽晨光金", hex: "#E5C287" }
    ]
  },
  {
    id: "dir_brain_reboot",
    title: "大一的腦袋過熱重開機模式",
    subtitle: "選課搶不到・搶到一席清幽心靈綠洲",
    hook: "選課系統轉圈圈、課表排得心好累？教你 5 分鐘關掉大腦雜訊的專注放鬆禪。",
    coreInsight: "新生開學前三週的巨大焦慮源自資訊轟炸與搶課挫折。主打『科學腹式呼吸』與『大一選課不踩雷經驗分享』，具備超強實用性。",
    visualConcept: "極簡科技人文感。冷杉灰綠與霧白底色，象徵清空大腦暫存快取（Cache），視覺無壓且高級。",
    colorPalette: [
      { name: "冷杉清灰綠", hex: "#4A6357" },
      { name: "極簡月光白", hex: "#FAFAF8" },
      { name: "琥珀茶湯金", hex: "#D4A359" },
      { name: "墨色沉澱黑", hex: "#232B28" }
    ]
  },
  {
    id: "dir_fuyuan_twilight",
    title: "福園黑天鵝池畔的午後微光慢活",
    subtitle: "零社交壓力・想靜靜喝杯茶就來",
    hook: "在淡江，最奢侈的不是早八睡飽，而是在傍晚的福園，吹著微風喝一杯剛泡好的高山茶。",
    coreInsight: "很多內向（I人）新生渴望社交卻排斥吵鬧迎新。保證『絕不強迫上台、零尷尬破冰、純品茶聊天』，徹底卸下防備心。",
    visualConcept: "文藝水波意象。福園池畔黑天鵝優雅倒影，搭配宮燈大道溫暖斜陽，氛圍感滿分，極適合拍照轉發。",
    colorPalette: [
      { name: "黛藍深湖水", hex: "#1F2F2D" },
      { name: "溫暖燕麥白", hex: "#EDE8DF" },
      { name: "茶韻焦糖褐", hex: "#B87A4B" },
      { name: "夕暮微光粉", hex: "#D8A499" }
    ]
  }
];

export const NTU_DIRECTIONS: RawDirection[] = [
  {
    id: "dir_ntu_yelin_recharge",
    title: "椰林大道迷路後的微光茶席",
    subtitle: "腳踏車先停好・大腦瞬間重開機",
    hook: "在總圖搶不到位子、初到椰林大道總是在迷路？來醉月湖畔喝杯冷泡茶放鬆吧。",
    coreInsight: "新生第一週在廣大校園中通勤焦慮與搶通識挫折。主打『無壓力交流』與『學長姐通識避雷指南』，親和力滿分。",
    visualConcept: "現代日系雜誌風。椰林綠意、湖畔水光與手作陶茶碗，右下角 36px 手作三色光圓形印章，留白充足。",
    colorPalette: [
      { name: "椰林深青綠", hex: "#2A4736" },
      { name: "醉月湖水碧", hex: "#5C8276" },
      { name: "溫潤米紙白", hex: "#F6F4ED" },
      { name: "晨曦活力金", hex: "#D9A84E" }
    ]
  },
  {
    id: "dir_ntu_course_oasis",
    title: "通識搶課轉圈圈・一席清幽心靈綠洲",
    subtitle: "初入公館校區・給自己一個按下 Pause 的午後",
    hook: "選課系統轉圈圈、課表排得心好累？來活大體驗 5 分鐘關掉雜訊的深層呼吸禪。",
    coreInsight: "開學初期雙主修與通識分發搶課焦慮。結合科學呼吸放鬆與學長姐選課求生分享，實用又無防衛感。",
    visualConcept: "科技人文簡約風。冷杉灰綠與霧白底色，象徵清空大腦記憶體，無壓放鬆。",
    colorPalette: [
      { name: "冷杉清灰綠", hex: "#4A6357" },
      { name: "極簡月光白", hex: "#FAFAF8" },
      { name: "琥珀茶湯金", hex: "#D4A359" },
      { name: "墨色沉澱黑", hex: "#232B28" }
    ]
  },
  {
    id: "dir_ntu_lake_slowlife",
    title: "醉月湖畔草地的微風午後慢活",
    subtitle: "零社交壓力・想靜靜喝杯好茶就來",
    hook: "在臺大，最奢侈的不是早八睡飽，而是在傍晚的醉月湖畔，吹著微風喝一杯現泡好茶。",
    coreInsight: "許多大一新鮮人抗拒吵鬧破冰。承諾『絕不強迫上台、純品茶聊天』，徹底卸下心防。",
    visualConcept: "水波草地光影意象。湖畔夕陽斜照，氛圍感滿分，適合轉貼分享。",
    colorPalette: [
      { name: "黛藍深湖水", hex: "#1F2F2D" },
      { name: "溫暖燕麥白", hex: "#EDE8DF" },
      { name: "茶韻焦糖褐", hex: "#B87A4B" },
      { name: "夕暮微光粉", hex: "#D8A499" }
    ]
  }
];

export const GENERAL_DIRECTIONS: RawDirection[] = [
  {
    id: "dir_general_recharge",
    title: "開學生活調適・15 分鐘心靈茶席",
    subtitle: "卸下新環境焦慮・大腦瞬間重開機",
    hook: "面對陌生的校園生活好焦慮？給自己一杯冷泡茶的時間，學長姐選課避雷指南都在這。",
    coreInsight: "新生適應期普遍對未知社交與課業焦慮。主打零推銷與實用經驗交流，完全消除防備心。",
    visualConcept: "清爽日系文藝風格。溫暖茶具、木質散景與角落 36px 手作三色光圓形印章。",
    colorPalette: [
      { name: "竹林深苔綠", hex: "#2E4036" },
      { name: "溫潤米紙白", hex: "#F7F5EE" },
      { name: "陶土茶韻褐", hex: "#C29B7F" },
      { name: "晨光暖橙金", hex: "#E5C287" }
    ]
  },
  {
    id: "dir_general_course_oasis",
    title: "大一選課避雷與心靈充電綠洲",
    subtitle: "選課不踩雷・搶到一席清幽心靈綠洲",
    hook: "選課排課排到心累？體驗 5 分鐘清空大腦雜訊的專注放鬆禪。",
    coreInsight: "大一選課為共同話題，結合科學專注放鬆與無社交壓力承諾。",
    visualConcept: "極簡現代排版。低飽和冷灰綠與柔白底色。",
    colorPalette: [
      { name: "冷杉清灰綠", hex: "#4A6357" },
      { name: "極簡月光白", hex: "#FAFAF8" },
      { name: "琥珀茶湯金", hex: "#D4A359" },
      { name: "墨色沉澱黑", hex: "#232B28" }
    ]
  },
  {
    id: "dir_general_slowlife",
    title: "校園午後微光的靜心慢活茶聚",
    subtitle: "零社交壓力・想靜靜喝杯茶就來",
    hook: "剛開學被各種迎新轟炸累了嗎？來這裡純喝杯好茶、吃塊手作點心。",
    coreInsight: "保證不強迫自我介紹與純茶席放空，專門吸引內向新生。",
    visualConcept: "自然光影茶席意象，高留白度。",
    colorPalette: [
      { name: "黛藍沉靜水", hex: "#1F2F2D" },
      { name: "溫暖燕麥白", hex: "#EDE8DF" },
      { name: "茶韻焦糖褐", hex: "#B87A4B" },
      { name: "暮色微光粉", hex: "#D8A499" }
    ]
  }
];

export function getRawDirectionsForDomain(domain: AudienceDomain): RawDirection[] {
  if (domain === "ntu") return NTU_DIRECTIONS;
  if (domain === "general") return GENERAL_DIRECTIONS;
  return TAMKANG_DIRECTIONS;
}

export function getSocialLogisticsForDomain(domain: AudienceDomain): DomainSocialLogistics {
  if (domain === "ntu") {
    return {
      badgeContent: "【臺大青年禪學交流會・新生迎新茶會】免費入場・備有點心",
      eventLogistics: [
        "📅 時間：開學第二週 每週二 18:30 - 20:00",
        "📍 地點：第一學生活動中心 (活大) 多功能室（或醉月湖畔草地）",
        "🍵 費用：完全免費（備有高山冷泡茶、手作茶點與文創小禮）"
      ].join("\n"),
      hashtags: [
        "#臺灣大學", "#臺大", "#椰林日常", "#臺大大一新生",
        "#通識避雷", "#醉月湖", "#大腦重開機", "#大學社團生活", "#茶會"
      ]
    };
  }

  if (domain === "general") {
    return {
      badgeContent: "【大學青年心靈茶席・新生迎新茶會】免費入場・備有點心",
      eventLogistics: [
        "📅 時間：開學第二週 每週二 18:30 - 20:00",
        "📍 地點：學生活動中心多功能教室（或校園綠意草坪）",
        "🍵 費用：完全免費（備有精選好茶與手作點心）"
      ].join("\n"),
      hashtags: [
        "#大學生活", "#大一新生", "#選課避雷", "#大腦重開機",
        "#心靈充電", "#社團茶會", "#茶席放鬆"
      ]
    };
  }

  return {
    badgeContent: "【淡江領袖禪學社・新生迎新茶會】免費入場・備有點心",
    eventLogistics: [
      "📅 時間：開學第二週 每週二 18:30 - 20:00",
      "📍 地點：學生活動中心 3 樓多功能社團教室（或宮燈長廊）",
      "🍵 費用：完全免費（備有精緻茶點與手作小禮）"
    ].join("\n"),
    hashtags: [
      "#淡江大學", "#淡江禪學社", "#克難坡日常", "#淡江大一新生",
      "#選課不踩雷", "#宮燈教室", "#大腦重開機", "#大學社團生活", "#茶會"
    ]
  };
}