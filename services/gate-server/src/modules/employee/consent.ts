import { Router } from 'express';

/** 문구를 바꾸면 판을 올린다. 직원마다 어느 판에 동의했는지 남긴다 */
export const CONSENT_VERSION = '2026-11-04';

export type ConsentDocument = {
  version: string;
  title: string;
  intro: string[];
  /** 본문 줄. `- `로 시작하면 항목, 나머지는 문단 */
  sections: { title: string; lines: string[] }[];
  agreement: string;
};

const COMPANY = '회사';

/** 출입 사진 보존 기간은 설정에서 바뀌므로 그때 값으로 채운다 */
export function consentDocument(photoRetentionDays: number): ConsentDocument {
  return {
    version: CONSENT_VERSION,
    title: '생체인식정보(얼굴인식정보) 수집·이용 동의서',
    intro: [
      `${COMPANY}는 사옥 출입관리와 본인 확인을 위해 얼굴인식 출입통제 시스템을 운영합니다.`,
      '얼굴인증에 쓰이는 얼굴 특징정보는 개인을 알아보는 데 쓰이는 생체인식정보로, 「개인정보 보호법」의 민감정보에 해당합니다. 그래서 아래 내용으로 따로 동의를 받습니다.',
    ],
    sections: [
      {
        title: '1. 수집·이용 목적',
        lines: [
          '- 사옥과 통제구역 출입 때 본인 확인',
          '- 스피드게이트 출입 권한 확인과 출입통제',
          '- 권한 없는 사람의 출입 방지와 시설 보안',
        ],
      },
      {
        title: '2. 수집·이용하는 정보',
        lines: [
          '- 얼굴 등록 때 촬영하거나 제출한 얼굴 사진',
          '- 얼굴 사진에서 뽑은 얼굴 특징정보(개인 식별용 특징값)',
          '- 출입 때 게이트 단말이 촬영한 사진과 그 사진의 얼굴 특징정보',
          '- 출입 일시, 게이트, 인증 성공·실패 결과',
        ],
      },
      {
        title: '3. 처리 방법',
        lines: [
          '등록한 얼굴 사진에서 얼굴 특징정보를 만들어 둡니다.',
          '출입할 때 단말이 촬영한 얼굴의 특징정보를 등록된 특징정보와 비교해 본인인지 확인합니다.',
          '생체인식정보는 사옥 출입과 본인 확인에만 쓰며, 따로 동의를 받지 않고 AI 모델 학습, 연구개발, 마케팅 등 다른 목적으로 쓰지 않습니다.',
        ],
      },
      {
        title: '4. 보유 및 이용 기간',
        lines: [
          '- 등록 얼굴 사진과 특징정보: 재직 중 또는 출입 권한이 있는 동안, 동의를 철회할 때까지',
          `- 출입 때 촬영한 사진: 출입 기록 확인을 위해 ${photoRetentionDays}일 보관한 뒤 자동 삭제`,
          '퇴사, 출입 권한 종료, 동의 철회로 목적을 다하면 법령이 따로 보관을 요구하지 않는 한 바로 안전하게 파기합니다.',
        ],
      },
      {
        title: '5. 동의 거부와 대체 출입 수단',
        lines: [
          '동의하지 않거나, 동의한 뒤에 인사 담당자에게 요청해 언제든 철회할 수 있습니다.',
          '동의하지 않으면 얼굴인증 출입은 쓸 수 없고, 회사가 주는 NFC 카드 등 다른 수단으로 출입할 수 있습니다.',
          '동의하지 않았다는 이유로 인사상 불이익을 받지 않습니다.',
        ],
      },
      {
        title: '6. 안전한 관리',
        lines: [
          `${COMPANY}는 생체인식정보가 분실, 도난, 유출, 위조, 변조, 훼손되지 않도록 접근 권한 관리, 접근 통제, 암호화 등 필요한 보호 조치를 합니다.`,
        ],
      },
    ],
    agreement: `본인은 위 내용을 충분히 확인했으며, ${COMPANY}가 위 목적으로 본인의 생체인식정보(얼굴인식정보)를 수집·이용하는 것에 동의합니다.`,
  };
}

/** 관리자 웹과 단말이 같은 문구를 보여 주도록 서버가 내려준다 */
export function createConsentRouter(photoRetentionDays: () => number): Router {
  return Router().get('/consent', (_req, res) => {
    res.json(consentDocument(photoRetentionDays()));
  });
}
