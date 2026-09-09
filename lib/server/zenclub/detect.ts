const CLUB_IDENTITY =
  /禪學社|領袖禪|淡大禪|tku_zc|SG109|生命靈數|登峰傳心|禪行破浪|金剛勇士虎|破曉挑戰營|攀越心峰|皇帝殿/i;

const CLUB_LOCAL = /社博|期初茶會|期初演講|入社單|擺攤|文館左側|挑戰營/;

const CLUB_EVENT = /茶會|社博|期初演講|入社|社課|社評|挑戰營|擺攤|招生/;

const TAMKANG_CAMPUS = /淡江|淡大|tku/i;

const OTHER_SCHOOL = /台大|臺大|成大|清大|政大|北大|成功大學|清華|政治大學/;

/** Drive knowledge is for 禪學社 internals, not every Tamkang query. */
export function needsZenclubKnowledge(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (OTHER_SCHOOL.test(value) && !TAMKANG_CAMPUS.test(value) && !CLUB_IDENTITY.test(value))
    return false;
  if (CLUB_IDENTITY.test(value) || CLUB_LOCAL.test(value)) return true;
  return TAMKANG_CAMPUS.test(value) && CLUB_EVENT.test(value);
}
