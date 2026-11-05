# 게이트 서버 + 관리자 웹 (P6). 단말 앱과 AI는 따로 설치한다
# 만들기: 저장소 맨 위에서 docker compose build

FROM node:24-bookworm-slim AS web
WORKDIR /src/apps/admin-web
COPY apps/admin-web/package.json apps/admin-web/package-lock.json ./
RUN npm ci
COPY apps/admin-web/ ./
RUN npm run build

FROM node:24-bookworm-slim
# ffmpeg: 현황 화면 단말 영상, tzdata: 한국 시간 로그
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg tzdata \
  && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Seoul \
  PORT=8080 \
  DB_PATH=/data/facegate.db \
  FILE_DIR=/data/files \
  BACKUP_DIR=/backup \
  ADMIN_WEB_DIR=/app/apps/admin-web/dist \
  GATES_FILE=/app/config/gates.json
WORKDIR /app/services/gate-server
COPY services/gate-server/package.json services/gate-server/package-lock.json ./
RUN npm ci --omit=dev
COPY services/gate-server/src ./src
COPY --from=web /src/apps/admin-web/dist /app/apps/admin-web/dist
VOLUME ["/data", "/backup"]
EXPOSE 8080 8443
CMD ["node", "src/main.ts"]
