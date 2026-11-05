import test from 'node:test';
import assert from 'node:assert/strict';
import { jamoLike, toJamo } from '../../src/shared/jamo.ts';

test('toJamo spells Hangul out so partial input matches', () => {
  assert.equal(toJamo('김'), 'ㄱㅣㅁ');
  // 입력 중간 상태가 완성된 글자에 들어 있어야 한다
  for (const typing of ['ㄱ', '기', '김', '김ㅊ', '김처', '김철'])
    assert.ok(toJamo('김철수').includes(toJamo(typing)), typing);
  assert.ok(toJamo('관리').includes(toJamo('고'))); // ㅘ = ㅗ + ㅏ
  assert.ok(toJamo('닭').includes(toJamo('달'))); // ㄺ = ㄹ + ㄱ
  assert.equal(toJamo('EMP-01 Kim'), 'emp-01 kim');
});

test('jamoLike escapes LIKE wildcards', () => {
  assert.equal(jamoLike('a_%\\'), '%a\\_\\%\\\\%');
});
