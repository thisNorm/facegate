// DRY_CONTACT: Modbus TCP 네트워크 릴레이로 게이트의 무전압 접점 입력을 펄스로 닫음 (04 문서 IF-3)
export type GateAdapter =
  | { type: 'MOCK' }
  | {
      type: 'DRY_CONTACT';
      host: string;
      port: number;
      unitId: number;
      coil: number;
      pulseMs: number;
    };

/**
 * 단말 = 카메라가 달린 안드로이드 기기 하나. 판정 화면을 띄우고 자기 카메라 영상을 RTSP로 내보낸다.
 * terminalKey는 AI 외부 계약의 device_key와 같은 값이다 (D-56).
 */
export type Terminal = {
  terminalKey: number;
  /** WebSocket 접속용 기기 토큰의 SHA-256 hex. 원문은 연결 순간 단말에만 보낸다 */
  tokenHash: string;
  /** 단말이 내보내는 영상 주소 (계정 포함). DB 값으로 만든다 */
  rtspUri: string;
};

export type Gate = {
  gateKey: number;
  name: string;
  adapter: GateAdapter;
  /** 지하는 음수. 모르면 null */
  floor: number | null;
  /** 로비 등 소속 권한 없이 모든 사람이 통과 (D-59) */
  openToAll: boolean;
  terminals: Terminal[];
};

export interface GateControl {
  open(gate: Gate): Promise<void>;
  /** 시작 시 한 번: 이전 크래시로 ON인 채 남은 코일을 해제 */
  releaseAll(gates: Gate[]): Promise<void>;
}
