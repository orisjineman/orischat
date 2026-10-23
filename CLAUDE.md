# CLAUDE.md

OrisChat — Node.js + Express + Socket.IO 실시간 웹 채팅. 가족/지인용 개인 사이드 프로젝트이며
Render 무료 플랜에 배포됨 (`main`에 push하면 자동 재배포). 사용자용 설명(환경 변수, 기능, 한계)은 [README.md](README.md).

@docs/ARCHITECTURE.md

영역별 세부 규칙은 `.claude/rules/`에 있고, 해당 경로의 파일을 다룰 때 자동으로 적용됨:
`testing.md`(test/), `client.md`(public/).

## 명령어

```bash
npm install
npm start                          # http://localhost:3000 (PORT로 변경)
npm test                           # node --test, 서버/DB 없이 전부 돌아감
node --test test/chat.test.js      # 파일 하나만
```

- Node 24+ (`.node-version`에 고정 — Render 배포와 CI(`.github/workflows/test.yml`)가 이 파일을 따름).
- 빌드 단계 없음.

## 핵심 규칙 (서버)

- **환경 변수는 전부 선택 사항.** 없으면 해당 기능만 조용히 꺼지고 서버는 떠야 함.
  - `TURSO_DATABASE_URL` 없음 → 메모리 폴백 (`lib/store.js`, `lib/pinStore.js`, `lib/pushSubscriptions.js`).
    DB 함수는 `whenEnabled(fallback, fn)`로 감싸서 꺼져 있으면 빈 값을 돌려줌. 새 저장 기능도 이 패턴을 따를 것.
  - `VAPID_*` 없음 → 푸시만 꺼짐, `GIPHY_API_KEY` 없음 → GIF 버튼 숨김 + `/api/gifs` 503, `CHAT_PIN` 없음 → 누구나 입장.
- **clientId는 절대 다른 클라이언트에 내려주지 않음.** 보는 사람마다 다른 값(`mine`, 리액션의 `mine`)은
  `emit.emitPersonalized()`와 `lib/present.js`(`toClientMessage(s)`)를 거쳐서 보냄. `io.to(room).emit`에 원본 행을 싣지 말 것.
- **서버에서 다시 검증.** 길이 상한은 `lib/config.js`의 `MAX`/`*_MAX_LENGTH`, 형식은 `lib/validation.js`.
- **새 소켓 이벤트는 rate limit을 건다.** `lib/rateLimiter.js`의 `LIMITS`에 항목 추가 후 핸들러 첫 줄에서 `limiters.x.check(socket.id)`.
  join 전 소켓(`socket.data.room` 없음)의 요청은 무시.
- 응답이 필요한 요청(검색, 더 보기, 내보내기, 링크 미리보기)은 별도 이벤트가 아니라 **ack 콜백**으로 돌려줌.
- 소켓 핸들러는 `lib/handlers/<기능>.js`에 `register(socket, { io, emit })`를 내보내고 `lib/handlers/index.js`에 등록.
- 메시지 타입: `text` | `sticker` | `image`(base64 data URL, DB에 저장) | `gif`(GIPHY CDN URL만 허용).
  새 타입을 추가하면 `lib/handlers/chat.js`의 `parseContent`, `lib/present.js`의 `previewOf`,
  `public/js/messages.js`, `public/js/exportFormat.js`를 함께 고칠 것.
- 스키마 변경은 `lib/db/schema.js`에서 `CREATE TABLE IF NOT EXISTS` + `ensureColumn()`으로 기존 DB를 보강하는 방식 (마이그레이션 도구 없음).

## 코드 스타일

- 서버는 CommonJS(`require`), `public/`은 ESM.
- 주석·로그·사용자 메시지·커밋 메시지는 **한국어**. 주석은 "왜"를 설명하는 쪽으로, 주변 밀도에 맞춰서.

## 자주 하는 작업

- **스티커 추가:** `public/stickers/`에 이미지(png/jpg/gif/webp)를 넣기만 하면 됨. 코드 수정·재시작 불필요.
  320px보다 크면 서버가 `.stickers-cache/`에 축소본을 만들어 서빙. 파일명은 로마자 소문자(`kkeudeok.png`).
- **배포:** `main`에 push → Render 자동 배포 (`render.yaml`).
