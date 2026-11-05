import type { AccessLogView } from './access.types.ts';

const RESULT_LABEL: Record<string, string> = {
  GRANTED: '허가',
  UNREGISTERED: '미등록',
  DENIED_GATE: '권한 없음',
  DENIED_TIME: '시간 외',
  DENIED_INACTIVE: '퇴사자',
  DUPLICATE: '중복',
  GATE_ERROR: '게이트 오류',
};
const METHOD_LABEL: Record<string, string> = { FACE: '얼굴', REMOTE: '원격', PHONE: '핸드폰' };
const REASON_LABEL: Record<string, string> = {
  VISITOR: '방문객',
  RECOGNITION_FAILED: '인식 실패',
  OTHER: '기타',
};
const HEADER = [
  '시각',
  '게이트',
  '결과',
  '인증 수단',
  '사번',
  '이름',
  '부서',
  '원격 사유',
  '방문객',
  '메모',
];

const BOM = String.fromCodePoint(0xfeff);

function cell(value: string | null | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // 엑셀 수식 실행 방지
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 엑셀이 한글을 바로 읽도록 UTF-8 BOM, 줄바꿈 CRLF */
export function toCsv(rows: AccessLogView[], gateNames: Map<number, string>): string {
  const lines = [HEADER.join(',')];
  for (const row of rows) {
    const visitor = row.visitorName
      ? row.visitorCompany
        ? `${row.visitorName} (${row.visitorCompany})`
        : row.visitorName
      : null;
    lines.push(
      [
        row.receivedAt.slice(0, 19),
        gateNames.get(row.gateKey) ?? String(row.gateKey),
        RESULT_LABEL[row.result] ?? row.result,
        METHOD_LABEL[row.method] ?? row.method,
        row.employeeNo,
        row.employeeName,
        row.department,
        row.remoteReason ? REASON_LABEL[row.remoteReason] : null,
        visitor,
        row.remoteNote,
      ]
        .map((value) => cell(value))
        .join(','),
    );
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
