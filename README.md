# stellar_status

등록된 [치지직(chzzk)](https://chzzk.naver.com) 스트리머들의 방송 상태(라이브 중 여부, 방송/영상 제목, 링크)를 주기적으로 수집해 HTTP API로 제공하는 서버입니다.

## 동작 방식

- Playwright로 headless Chromium을 띄워 각 스트리머의 치지직 채널 페이지를 방문하고, 페이지가 자체적으로 호출하는 `live-detail`/`videos` API 응답을 가로채 방송 상태를 읽어옵니다. (서버 간 직접 API 호출은 WAF에 막히지만, 실제 브라우저 요청은 통과합니다.)
- 라이브 중이면 라이브 정보를, 아니면 가장 최근 다시보기 정보를 저장합니다.
- 등록된 전체 스트리머를 순서대로 한 바퀴(cycle) 조회한 뒤, 일정 시간 대기하고 다시 반복합니다.
- 수집한 상태는 메모리에 저장되며, Express API로 조회할 수 있습니다.

## 요구 사항

- Node.js
- `npx playwright install chromium` (Playwright 브라우저 바이너리, 최초 1회)

## 설치

```bash
npm install
npx playwright install chromium
```

## 환경 변수 설정

`.env.example`을 복사해 `.env`를 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

| 변수 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `PORT` | 예 | - | HTTP 서버가 열릴 포트 |
| `STELLAR_STATUS_STARTUP_DELAY_MS` | 아니오 | `5000` | 첫 폴링 순환 시작 전 대기 시간(ms), 0~120000 범위 밖이면 기본값 사용 |

## 실행

```bash
npm start
```

`tsc --watch`와 `node ./dist/index.js`를 동시에 실행합니다(`concurrently`).

## API

- `GET /health` — 서버 상태, 폴링 설정값, 마지막 갱신 시각
- `GET /status` — 등록된 모든 스트리머의 현재 상태
- `GET /status/:stellarId` — 특정 스트리머(`src/streamers.ts`의 `name`)의 현재 상태

## 스트리머 목록 수정

`src/streamers.ts`의 `STREAMERS` 배열에 `{ name, channelId }` 형태로 추가/삭제합니다. `channelId`는 치지직 채널 URL(`https://chzzk.naver.com/live/{channelId}`)의 값입니다.
