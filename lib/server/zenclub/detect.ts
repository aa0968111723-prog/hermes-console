const CLUB_IDENTITY =
  /禪學社|領袖禪|淡大禪|tku_zc|SG109|生命靈數|登峰傳心|禪行破浪|金剛勇士虎|破曉挑戰營/i;

const CLUB_EVENT = /茶會|社博|期初演講|入社|社課|社評|挑戰營|擺攤|招生/;

const TAMKANG_CAMPUS = /淡江|淡大|tku/i;

/** Drive knowledge is for 禪學社 internals, not every Tamkang query. */
export function needsZenclubKnowledge(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (CLUB_IDENTITY.test(value)) return true;
  return TAMKANG_CAMPUS.test(value) && CLUB_EVENT.test(value);
}
