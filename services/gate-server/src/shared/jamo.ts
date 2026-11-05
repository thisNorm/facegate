// 한글을 자모로 풀어 쓴다. 입력 중인 글자("ㄱ", "기")로도 "김"을 찾게 검색 양쪽에 같이 쓴다
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
// 겹자모는 두 번 눌러 만드는 것이라 입력 중간 상태와 맞추려면 나눠야 한다 ("고" 다음 "과")
const SPLIT: Record<string, string> = {
  ㄳ: 'ㄱㅅ',
  ㄵ: 'ㄴㅈ',
  ㄶ: 'ㄴㅎ',
  ㄺ: 'ㄹㄱ',
  ㄻ: 'ㄹㅁ',
  ㄼ: 'ㄹㅂ',
  ㄽ: 'ㄹㅅ',
  ㄾ: 'ㄹㅌ',
  ㄿ: 'ㄹㅍ',
  ㅀ: 'ㄹㅎ',
  ㅄ: 'ㅂㅅ',
  ㅘ: 'ㅗㅏ',
  ㅙ: 'ㅗㅐ',
  ㅚ: 'ㅗㅣ',
  ㅝ: 'ㅜㅓ',
  ㅞ: 'ㅜㅔ',
  ㅟ: 'ㅜㅣ',
  ㅢ: 'ㅡㅣ',
};

export function toJamo(text: string): string {
  let out = '';
  for (const char of text.toLowerCase()) {
    const code = char.charCodeAt(0) - 0xac00;
    const parts =
      code >= 0 && code < 11172
        ? CHO[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)] + JONG[code % 28]
        : char;
    for (const part of parts) out += SPLIT[part] ?? part;
  }
  return out;
}

/** SQL `jamo(column) LIKE ? ESCAPE '\'`에 넣을 부분 일치 패턴 */
export const jamoLike = (text: string) =>
  `%${toJamo(text).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
