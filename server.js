const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sharp = require('sharp');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
// 설정해두면 입장 시 이 비밀번호를 맞춰야 함 (안 정하면 누구나 바로 입장 가능)
const CHAT_PIN = process.env.CHAT_PIN || '';

// 현재 접속 중인 사용자 목록 (socket.id -> nickname)
const users = new Map();

// 메시지별 반응(이모지 리액션): messageId -> { emoji -> Set of clientId }
// DB 연동 전이라 서버 재시작하면 사라짐 (메시지 자체도 마찬가지)
const reactions = new Map();

function broadcastUserList() {
  io.emit('user-list', Array.from(users.values()));
}

app.get('/api/config', (req, res) => {
  res.json({ pinRequired: Boolean(CHAT_PIN) });
});

// public/stickers 폴더에 이미지를 넣으면 자동으로 스티커로 인식됨 (서버 재시작 불필요)
const STICKERS_DIR = path.join(__dirname, 'public', 'stickers');
const STICKERS_CACHE_DIR = path.join(__dirname, '.stickers-cache');
const STICKER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// 스티커 원본이 이 크기(긴 쪽 기준, px)보다 크면 줄여서 보내고, 작으면 원본 그대로 보냄
const STICKER_MAX_DIMENSION = 320;

function listStickers() {
  try {
    return fs
      .readdirSync(STICKERS_DIR)
      .filter((name) => STICKER_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

app.get('/api/stickers', (req, res) => {
  res.json(listStickers());
});

// 스티커 이미지 서빙: 원본이 크면 줄여서 캐시에 저장해두고 그걸 내려줌.
// express.static보다 먼저 등록해야 이 라우트가 우선 처리됨.
app.get('/stickers/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!listStickers().includes(filename)) {
    return res.status(404).end();
  }

  const srcPath = path.join(STICKERS_DIR, filename);
  const cachePath = path.join(STICKERS_CACHE_DIR, filename);

  try {
    const srcStat = fs.statSync(srcPath);

    // 리사이즈된 캐시가 이미 있고 원본보다 최신이면 그대로 서빙
    if (fs.existsSync(cachePath)) {
      const cacheStat = fs.statSync(cachePath);
      if (cacheStat.mtimeMs >= srcStat.mtimeMs) {
        return res.sendFile(cachePath);
      }
    }

    const isGif = path.extname(filename).toLowerCase() === '.gif';
    const image = sharp(srcPath, { animated: isGif });
    const meta = await image.metadata();

    // 원본이 이미 충분히 작으면 재인코딩 없이 그대로 서빙 (품질 손실 방지)
    if ((meta.width || 0) <= STICKER_MAX_DIMENSION && (meta.height || 0) <= STICKER_MAX_DIMENSION) {
      return res.sendFile(srcPath);
    }

    fs.mkdirSync(STICKERS_CACHE_DIR, { recursive: true });
    await image
      .resize({
        width: STICKER_MAX_DIMENSION,
        height: STICKER_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toFile(cachePath);

    res.sendFile(cachePath);
  } catch (err) {
    console.error('스티커 처리 중 오류:', err);
    res.status(500).end();
  }
});

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    // 문자열(구버전 클라이언트)과 { nickname, clientId, pin } 객체 둘 다 지원
    const { nickname, clientId, pin } = typeof data === 'string' ? { nickname: data, clientId: null, pin: '' } : (data || {});

    if (CHAT_PIN && pin !== CHAT_PIN) {
      socket.emit('join-error', '비밀번호가 틀렸습니다.');
      return;
    }

    const cleanName = String(nickname || '').trim().slice(0, 20) || `손님${socket.id.slice(0, 4)}`;
    // clientId는 브라우저마다 고유한 값으로, 재연결되어도 "나"를 정확히 구분하기 위해 사용
    const id = String(clientId || socket.id).slice(0, 100);

    users.set(socket.id, cleanName);
    socket.data.nickname = cleanName;
    socket.data.clientId = id;

    socket.emit('joined', { nickname: cleanName, clientId: id });
    socket.broadcast.emit('system-message', `${cleanName}님이 입장했습니다.`);
    broadcastUserList();
  });

  socket.on('chat-message', (payload) => {
    // 문자열(구버전 클라이언트)과 { type, content } 객체 둘 다 지원
    const data = typeof payload === 'string' ? { type: 'text', content: payload } : (payload || {});
    const nickname = socket.data.nickname || '알수없음';
    const id = crypto.randomUUID();

    if (data.type === 'sticker') {
      // 경로 조작(../ 등) 방지 + 실제 존재하는 스티커 파일인지 검증
      const filename = path.basename(String(data.content || ''));
      if (!listStickers().includes(filename)) return;
      io.emit('chat-message', {
        id,
        type: 'sticker',
        content: filename,
        nickname,
        time: Date.now(),
        clientId: socket.data.clientId,
      });
      return;
    }

    const message = String(data.content || '').trim().slice(0, 500);
    if (!message) return;
    io.emit('chat-message', {
      id,
      type: 'text',
      content: message,
      nickname,
      time: Date.now(),
      clientId: socket.data.clientId,
    });
  });

  socket.on('react', ({ messageId, emoji } = {}) => {
    const clientId = socket.data.clientId;
    if (!clientId || !messageId || !emoji) return;

    if (!reactions.has(messageId)) reactions.set(messageId, new Map());
    const byEmoji = reactions.get(messageId);
    if (!byEmoji.has(emoji)) byEmoji.set(emoji, new Set());
    const clientIds = byEmoji.get(emoji);

    // 이미 눌렀던 반응이면 취소(토글), 아니면 추가
    if (clientIds.has(clientId)) {
      clientIds.delete(clientId);
      if (clientIds.size === 0) byEmoji.delete(emoji);
    } else {
      clientIds.add(clientId);
    }

    const summary = {};
    for (const [e, ids] of byEmoji.entries()) {
      summary[e] = Array.from(ids);
    }
    io.emit('reaction-update', { messageId, reactions: summary });
  });

  socket.on('typing', (isTyping) => {
    const nickname = socket.data.nickname;
    if (!nickname) return;
    socket.broadcast.emit('typing', { nickname, isTyping: !!isTyping });
  });

  socket.on('disconnect', () => {
    const nickname = users.get(socket.id);
    if (nickname) {
      users.delete(socket.id);
      socket.broadcast.emit('system-message', `${nickname}님이 퇴장했습니다.`);
      broadcastUserList();
    }
  });
});

server.listen(PORT, () => {
  console.log(`채팅 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
