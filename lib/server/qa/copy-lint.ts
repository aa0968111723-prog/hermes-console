import type { CopyLintIssue } from "./types";

const SIMPLIFIED_CLUB = [
  "禅学社",
  "禅學社",
  "禪学社",
  "淡江大学禪學社",
  "淡江大学禅学社",
];

const WRONG_CLUB = ["佛學社", "佛光社", "慈濟青年社", "淡江科技大學"];

const SIMPLIFIED_PROMO = [
  ["报名", "報名"],
  ["活动", "活動"],
  ["社团", "社團"],
  ["学社", "學社"],
  ["茶会", "茶會"],
];

const CANONICAL_CLUB = /淡江大學禪學社|淡江禪學社|淡大禪學社|禪學社|tku_zc/i;

export function clubContext(text: string) {
  return CANONICAL_CLUB.test(text) || /禪學|領袖禪|登峰傳心|禪行破浪/.test(text);
}

export function lintCopyText(text: string): CopyLintIssue[] {
  const issues: CopyLintIssue[] = [];
  for (const wrong of SIMPLIFIED_CLUB) {
    if (text.includes(wrong)) {
      issues.push({
        code: "simplified_club_name",
        status: "CONFLICTING",
        message: "社名使用簡體或缺字（" + wrong + "）。正確為「淡江大學禪學社／禪學社」。",
      });
    }
  }
  if (clubContext(text)) {
    for (const wrong of WRONG_CLUB) {
      if (text.includes(wrong)) {
        issues.push({
          code: "wrong_club_name",
          status: "CONFLICTING",
          message: "文案出現其他社團名稱「" + wrong + "」，與禪學社衝突。",
        });
      }
    }
  }
  for (const [simplified, traditional] of SIMPLIFIED_PROMO) {
    if (text.includes(simplified)) {
      issues.push({
        code: "simplified_promo",
        status: "UNVERIFIED",
        message: "文案含簡體「" + simplified + "」，請改為「" + traditional + "」。",
      });
    }
  }
  if (/QR\s*Code|QR碼|qrcode|二維碼|二维码/i.test(text)) {
    issues.push({
      code: "qr_mentioned",
      status: "UNVERIFIED",
      message: "文案提到 QR。系統未讀圖核對 QR 內容，不得假裝已驗證。",
    });
  }
  if (/出血|300\s*dpi|A4|A3|DM|海報/.test(text)) {
    issues.push({
      code: "print_spec_unverified",
      status: "UNVERIFIED",
      message: "印刷尺寸／出血未量測實體檔，標 UNVERIFIED。",
    });
  }
  return unique(issues);
}

function unique(issues: CopyLintIssue[]) {
  const seen = new Set<string>();
  return issues.filter((item) => {
    if (seen.has(item.message)) return false;
    seen.add(item.message);
    return true;
  });
}
