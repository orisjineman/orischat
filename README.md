# OrisChat

간단한 실시간 웹 채팅 서버입니다. Node.js + Express + Socket.IO로 만들었고, 별도 설치 없이 브라우저에서 바로 접속해 대화할 수 있습니다.

## 기능

- 닉네임만 입력하면 바로 입장
- 실시간 메시지 송수신 (WebSocket 기반)
- 여러 개의 채팅방 (방 이름을 비워두면 모두 같은 기본 방으로 입장, `?room=이름`으로 특정 방 공유 가능, 로그인 화면에서 활동 중인 방 목록도 보여줌)
- 입장 / 퇴장 시스템 알림
- 현재 접속자 목록
- "입력 중..." 표시
- 커스텀 스티커 (`public/stickers/`에 이미지만 넣으면 자동으로 추가됨, 큰 이미지는 자동으로 축소)
- 이모지 리액션 (메시지에 👍❤️😂 등으로 반응)
- 본인이 보낸 메시지 삭제 / 텍스트 메시지 수정("(수정됨)" 표시)
- 답장 (원문을 인용해서 표시, 원문이 삭제돼도 인용은 남음)
- @닉네임 멘션 — 하이라이트 표시되고, 멘션되면 탭을 보고 있어도 우선 알림
- 사진 첨부 — 브라우저에서 리사이즈/압축 후 전송(서버 파일시스템에는 저장 안 함, 용량 상한 있음)
- 메시지 검색 (방 안에서)
- 메시지 링크 자동 하이퍼링크
- 사진/스티커 클릭 시 확대해서 보기(라이트박스)
- 답장 인용문 클릭하면 원본 메시지로 스크롤 이동
- 이전 대화를 읽으려고 위로 스크롤하면 새 메시지가 와도 화면이 안 당겨지고, ⬇ 버튼으로 원할 때 맨 아래로 이동
- 프로필 사진 (닉네임 기준으로 저장, 안 설정하면 이니셜 원형 배지, 클릭하면 확대해서 보기)
- 읽음 표시 — 방에 있는 모두가 그 메시지까지 읽으면 "읽음" 표시(탭이 보일 때만 읽음 처리)
- 닉네임별 고정 아바타 색상 (프로필 사진 없을 때)
- "이전 메시지 더 보기"로 지난 대화 페이지 단위로 불러오기
- 브라우저 알림 — [Web Push](https://web.dev/push-notifications-overview/) 설정 시 브라우저/탭을 완전히 닫아도 알림 수신, 미설정 시에도 탭이 안 보일 때는 알림(포그라운드 한정)
- 도배 방지 (짧은 시간에 메시지/리액션을 너무 많이 보내면 잠시 제한)
- 입장 비밀번호 (선택, `CHAT_PIN` 환경 변수로 설정)
- 메시지/리액션/프로필 사진/푸시 구독 영구 저장 ([Turso](https://turso.tech) 연동 시, 서버 재시작해도 대화 유지 / 7일 지난 메시지는 자동 삭제)
- 새로고침해도 대화 유지 (탭을 닫으면 초기화)
- 라이트 / 다크 모드 자동 대응 + 수동 선택 (IntelliJ, Excel 테마도 있음)
- PWA (홈 화면에 추가해서 앱처럼 사용 가능)
- 다른 사람에게 내 영구 식별자가 노출되지 않음 (닉네임을 바꿔도 안 변하는 값이라 추적 우려가 있어, 서버가 "내가 쓴 메시지인지"만 계산해서 알려주고 원래 값은 절대 넘기지 않음)

## 기술 스택

- [Express](https://expressjs.com/) — 정적 파일/HTTP API 서빙
- [Socket.IO](https://socket.io/) — 실시간 양방향 통신
- [libSQL 클라이언트](https://github.com/tursodatabase/libsql-client-ts) ([Turso](https://turso.tech)) — 선택적 영구 저장 (없으면 메모리 폴백)
- [web-push](https://github.com/web-push-libs/web-push) — 백그라운드 푸시 알림
- [sharp](https://sharp.pixelplumbing.com/) — 큰 스티커 이미지 자동 축소
- Vanilla JS / HTML / CSS — 프론트엔드 프레임워크/번들러 없이 브라우저 네이티브 ES 모듈(`<script type="module">`)로 구성

## 시작하기

```bash
npm install
npm start
```

기본적으로 `http://localhost:3000` 에서 접속할 수 있습니다. 포트를 바꾸고 싶다면 `PORT` 환경 변수를 지정하세요.

```bash
PORT=4000 npm start
```

입장 시 비밀번호를 요구하게 하려면 `CHAT_PIN`을 설정하세요 (안 정하면 누구나 바로 입장 가능).

```bash
CHAT_PIN=1234 npm start
```

Render에 배포한 경우 대시보드의 **Environment** 탭에서 환경 변수를 추가하면 됩니다.

### 메시지 영구 저장 (Turso)

메시지를 영구 저장하려면 [Turso](https://turso.tech)에서 무료 데이터베이스를 만들고 아래 두 환경 변수를 설정하세요 (안 정하면 메모리에만 저장되어 서버 재시작 시 사라짐).

```bash
TURSO_DATABASE_URL=libsql://xxxx.turso.io
TURSO_AUTH_TOKEN=xxxx
```

### 백그라운드 푸시 알림 (선택)

브라우저/탭을 완전히 닫아도 알림을 받으려면 [VAPID](https://web.dev/push-notifications-overview/) 키가 필요합니다. 아래 명령으로 키 쌍을 한 번 생성하고(네트워크 필요 없음, 로컬에서 바로 생성됨):

```bash
npx web-push generate-vapid-keys
```

나온 값을 환경 변수로 설정하세요.

```bash
VAPID_PUBLIC_KEY=xxxx
VAPID_PRIVATE_KEY=xxxx
VAPID_SUBJECT=mailto:you@example.com   # 선택, 기본값 있음
```

설정하지 않으면 백그라운드 푸시만 꺼지고, 탭이 열려 있는 동안(숨겨진 상태 포함)의 알림은 그대로 동작합니다. 구독 정보는 Turso가 설정돼 있으면 DB에, 아니면 메모리에만 저장됩니다.

### 방(room)

입장 화면에서 "방 이름"을 비워두면 모두 같은 기본 방(`general`)에 들어갑니다. 방 이름을 입력하면 그 이름으로 접속한 사람들끼리만 대화가 보이고, 입장 후 주소가 `?room=방이름`으로 바뀌니 그 링크를 공유하면 같은 방으로 바로 들어올 수 있습니다.

## 프로젝트 구조

```
.
├── server.js              # Express + Socket.IO 서버 조립/시작 (라우트·핸들러 연결만 함)
├── db.js                  # 저장소(Turso/libSQL) 진입점 — lib/db/ 모듈을 모아서 내보냄
├── push.js                # 웹 푸시(Web Push) 알림 구독/발송
├── lib/                   # 서버 내부 모듈
│   ├── config.js            #   상수/환경 변수
│   ├── state.js             #   접속자, 메시지 작성자 캐시, 읽음 위치 (메모리)
│   ├── store.js             #   리액션/프로필 사진 저장소 (DB 또는 메모리 폴백)
│   ├── pushSubscriptions.js #   푸시 구독 저장소 (DB 또는 메모리 폴백)
│   ├── present.js           #   서버 데이터를 "보는 사람 기준"으로 변환 (clientId 비노출)
│   ├── emitters.js          #   방 전체/개인별 전송 헬퍼 (접속자 목록, 읽음 갱신 등)
│   ├── rateLimiter.js       #   도배 방지 (이벤트별 제한)
│   ├── validation.js        #   입력 검증
│   ├── routes.js            #   HTTP API (/api/config, /api/rooms, /avatar/:nickname)
│   ├── stickers.js          #   스티커 목록/이미지 서빙 (큰 이미지는 축소해서 캐시)
│   ├── db/                  #   테이블별 DB 모듈 (client, schema, messages, reactions,
│   │                        #   subscriptions, avatars)
│   └── handlers/            #   소켓 이벤트별 핸들러 (session, chat, reactions,
│                            #   messageActions, history, avatar, presence, pushSubscription)
├── public/
│   ├── index.html           # 채팅 화면 UI
│   ├── style.css            # 스타일 (라이트/다크/IntelliJ/Excel 테마)
│   ├── client.js            # 클라이언트 진입점 — js/ 모듈을 불러옴
│   ├── js/                  # 기능별 ES 모듈 (login, messages, compose, avatar, reactions,
│   │                        # reply, search, read, theme, notifications, lightbox, ...)
│   ├── package.json         # {"type":"module"} — 테스트에서 Node가 이 폴더를 ESM으로 읽게 함
│   ├── manifest.json        # PWA 매니페스트
│   ├── service-worker.js    # 백그라운드 푸시 수신용 Service Worker
│   ├── icons/               # PWA 아이콘
│   └── stickers/            # 커스텀 스티커 이미지 (아래 참고)
├── test/                  # 서버/클라이언트 테스트 (node --test, 아래 참고)
│   └── helpers/             #   소켓 하네스, 가짜 web-push, push 공용 시나리오
└── package.json
```

## 테스트

```bash
npm test
```

Node 내장 테스트 러너(`node --test`)로 실행하며, 별도 서버나 DB 없이 돌아갑니다. 테스트 파일마다 별도 프로세스라서, 환경 변수(DB/VAPID/PIN)가 다른 모드를 파일 단위로 나눠 검증합니다.

| 파일 | 검증 대상 |
| --- | --- |
| `chat.test.js`, `chat-events.test.js` | 소켓 이벤트 전반 — 입장 정리, 메시지 검증(길이/스티커/사진/답장/멘션), 리액션, 삭제·수정 권한, 입력 중, 읽음 표시, 도배 방지 (메모리 모드) |
| `http.test.js` | HTTP API, 스티커 서빙(경로 조작 차단), 프로필 사진 |
| `chat-db.test.js` | DB 모드 통합 — 대화 기록 복원, 페이지네이션, 검색, 수정, 삭제, 7일 정리 (로컬 libSQL 파일 사용) |
| `chat-pin.test.js` | `CHAT_PIN` 설정 서버 |
| `db.test.js`, `db-disabled.test.js` | `db.js` 단위 테스트(옛 스키마 마이그레이션 포함), DB 미설정 시 계약 |
| `push*.test.js` | 푸시 구독/발송 — 메모리·DB 두 저장 경로에 같은 시나리오, VAPID 미설정/반쪽 설정 (`web-push`는 가짜로 대체) |
| `client.test.js` | 브라우저 클라이언트 — 실제 `index.html`을 [jsdom](https://github.com/jsdom/jsdom)에 올리고 가짜 소켓으로 서버 이벤트를 흉내내 DOM/전송 이벤트 검증 |

- 특정 파일만 실행: `node --test test/db.test.js`
- 클라이언트 테스트는 jsdom 때문에 **Node 20.19 이상**이 필요합니다.
- GitHub Actions에서 push/PR마다 자동으로 돌아갑니다 (`.github/workflows/test.yml`, Node 20).

## 커스텀 스티커 추가하기

`public/stickers/` 폴더에 이미지 파일(`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`)을 넣으면 자동으로 스티커 목록에 나타납니다. 원본이 320px(긴 쪽 기준)보다 크면 자동으로 축소해서 서빙하고, 작으면 원본 그대로 보냅니다. 서버를 재시작할 필요 없이, 파일을 넣고 채팅창에서 스티커 버튼(😊)을 눌러보면 바로 보입니다.

## 배포 (Render)

이 저장소는 [Render](https://render.com)에 배포되어 있습니다 (`render.yaml` 참고). GitHub 저장소에 push하면 자동으로 재배포됩니다.

Render 무료 플랜은 15분간 요청이 없으면 서버가 잠들고, 다음 요청 때 다시 깨어나는 데 30~60초 정도 걸립니다. `.github/workflows/keep-alive.yml`이 10분마다 핑을 보내 항상 깨어있게 유지합니다.

## 참고 / 한계

- `TURSO_DATABASE_URL`을 설정하지 않으면 메시지/리액션/프로필 사진/푸시 구독이 메모리에만 저장되어 서버가 재시작되면 사라집니다. "이전 메시지 더 보기", 메시지 수정, 검색은 DB가 있어야 동작합니다.
- `CHAT_PIN`을 설정하지 않으면 접속 주소를 아는 사람은 누구나 들어올 수 있습니다.
- 사진 첨부는 용량 상한(base64 기준 약 700KB, 원본 500KB 정도)이 있고, 넘으면 거부됩니다. 서버 파일시스템이 아니라 DB에 저장되므로 무료 DB 용량을 고려한 제한입니다 — 7일 지나면 메시지와 함께 자동 삭제됩니다.
- 방 목록은 "현재 접속자가 있는 방"과 "DB에 메시지 기록이 있는 방"만 보여줍니다. 방 이름을 URL 파라미터로 공유하는 방식은 그대로 유효합니다.
- 읽음 표시는 "현재 방에 접속 중인 사람 기준"이라, 재시작하면 초기화됩니다(DB에 저장 안 함). 프로필 사진은 닉네임 기준으로 저장되어, 같은 닉네임을 쓰는 다른 사람과 공유됩니다.

## 라이선스

개인 사이드 프로젝트입니다.
