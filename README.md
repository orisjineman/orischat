# OrisChat

간단한 실시간 웹 채팅 서버입니다. Node.js + Express + Socket.IO로 만들었고, 별도 설치 없이 브라우저에서 바로 접속해 대화할 수 있습니다.

## 기능

- 닉네임만 입력하면 바로 입장
- 실시간 메시지 송수신 (WebSocket 기반)
- 입장 / 퇴장 시스템 알림
- 현재 접속자 목록
- "입력 중..." 표시
- 커스텀 스티커 (`public/stickers/`에 이미지만 넣으면 자동으로 추가됨, 큰 이미지는 자동으로 축소)
- 새로고침해도 대화 유지 (탭을 닫으면 초기화)
- 라이트 / 다크 모드 자동 대응 UI

## 기술 스택

- [Express](https://expressjs.com/) — 정적 파일 서빙
- [Socket.IO](https://socket.io/) — 실시간 양방향 통신
- Vanilla JS / HTML / CSS (프론트엔드 프레임워크 없음)

## 시작하기

```bash
npm install
npm start
```

기본적으로 `http://localhost:3000` 에서 접속할 수 있습니다. 포트를 바꾸고 싶다면 `PORT` 환경 변수를 지정하세요.

```bash
PORT=4000 npm start
```

## 프로젝트 구조

```
.
├── server.js          # Express + Socket.IO 서버
├── public/
│   ├── index.html      # 채팅 화면 UI
│   ├── style.css        # 스타일
│   ├── client.js        # 클라이언트 로직 (입장, 메시지 송수신 등)
│   └── stickers/        # 커스텀 스티커 이미지 (아래 참고)
└── package.json
```

## 커스텀 스티커 추가하기

`public/stickers/` 폴더에 이미지 파일(`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`)을 넣으면 자동으로 스티커 목록에 나타납니다. 원본이 320px(긴 쪽 기준)보다 크면 자동으로 축소해서 서빙하고, 작으면 원본 그대로 보냅니다. 서버를 재시작할 필요 없이, 파일을 넣고 채팅창에서 스티커 버튼(😊)을 눌러보면 바로 보입니다.

## 배포 (Render)

이 저장소는 [Render](https://render.com)에 배포되어 있습니다 (`render.yaml` 참고). GitHub 저장소에 push하면 자동으로 재배포됩니다.

Render 무료 플랜은 15분간 요청이 없으면 서버가 잠들고, 다음 요청 때 다시 깨어나는 데 30~60초 정도 걸립니다. `.github/workflows/keep-alive.yml`이 10분마다 핑을 보내 항상 깨어있게 유지합니다.

## 참고 / 한계

- 메시지가 메모리에만 저장되어 서버가 재시작되면 대화 기록이 사라집니다 (별도 DB 연동 없음). 각자 브라우저의 `sessionStorage`에 최근 대화가 남아있어서 새로고침해도 유지되지만, 자리를 비운 사이 온 메시지는 다시 볼 수 없습니다.
- 로그인/비밀번호가 없어 접속 주소를 아는 사람은 누구나 들어올 수 있습니다

## 라이선스

개인 사이드 프로젝트입니다.
