import { useRef, useState } from 'react';
import { api } from '../api';
import { todayKst } from '../format';
import { useLoad } from '../useLoad';
import { Dialog } from './Dialog';

type ConsentDocument = {
  version: string;
  title: string;
  intro: string[];
  sections: { title: string; lines: string[] }[];
  agreement: string;
};
export type ConsentPerson = { name: string; employeeNo: string; department: string };

/**
 * 등록하는 직원 본인이 읽고 직접 누르는 생체정보 동의서. 문구는 서버가 준다.
 * 아래 고정 줄의 오른쪽 버튼은 끝까지 내려가기 전에는 "끝까지 보기", 그 뒤에는 "동의합니다" (단말과 같음)
 */
export function ConsentDialog({
  open,
  person,
  onAgree,
  onDecline,
}: {
  open: boolean;
  person: ConsentPerson;
  onAgree: () => void;
  onDecline: () => void;
}) {
  return (
    <Dialog open={open} title="생체정보 동의" onClose={onDecline}>
      <ConsentBody person={person} onAgree={onAgree} onDecline={onDecline} />
    </Dialog>
  );
}

function ConsentBody({
  person,
  onAgree,
  onDecline,
}: {
  person: ConsentPerson;
  onAgree: () => void;
  onDecline: () => void;
}) {
  const doc = useLoad(() => api<ConsentDocument>('GET', '/api/admin/consent'), []);
  const scroller = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const checkEnd = () => {
    const el = scroller.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setAtEnd(true);
  };

  if (doc.error) return <p className="error">동의서를 불러오지 못했습니다. ({doc.error})</p>;
  if (!doc.data) return <p className="empty-state">동의서를 불러오는 중입니다.</p>;
  const d = doc.data;
  const who = [person.employeeNo && `사번 ${person.employeeNo}`, person.department]
    .filter(Boolean)
    .join(', ');
  return (
    <div className="consent">
      <div className="consent-head">
        <strong>{d.title}</strong>
        <span className="muted">{`${person.name} 님${who ? ` (${who})` : ''}`}</span>
      </div>
      <div className="consent-scroll" ref={scroller} onScroll={checkEnd}>
        {d.intro.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {d.sections.map((section) => (
          <section key={section.title}>
            <h4>{section.title}</h4>
            {section.lines.some((l) => l.startsWith('- ')) && (
              <ul>
                {section.lines
                  .filter((l) => l.startsWith('- '))
                  .map((l) => (
                    <li key={l}>{l.slice(2)}</li>
                  ))}
              </ul>
            )}
            {section.lines
              .filter((l) => !l.startsWith('- '))
              .map((l) => (
                <p key={l}>{l}</p>
              ))}
          </section>
        ))}
        <p className="consent-agreement">{d.agreement}</p>
        <dl className="consent-person">
          <dt>성명</dt>
          <dd>{person.name}</dd>
          <dt>소속</dt>
          <dd>{person.department || '없음'}</dd>
          <dt>사번</dt>
          <dd>{person.employeeNo}</dd>
          <dt>동의일</dt>
          <dd>{todayKst()}</dd>
        </dl>
        <p className="note">{`동의서 ${d.version}판`}</p>
      </div>
      <div className="consent-bar">
        <button type="button" onClick={onDecline}>
          동의하지 않음
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            if (atEnd) {
              onAgree();
              return;
            }
            const el = scroller.current;
            el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
            setAtEnd(true);
          }}
        >
          {atEnd ? '동의합니다' : '끝까지 보기'}
        </button>
      </div>
    </div>
  );
}
