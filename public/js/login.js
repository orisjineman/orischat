import { DEFAULT_ROOM, NICKNAME_KEY, PIN_KEY, ROOM_KEY } from './constants.js';
import {
  chatScreen,
  gifBtn,
  joinBtn,
  joinError,
  loginScreen,
  messageInput,
  nicknameInput,
  pinInput,
  roomInput,
  roomLabel,
  roomListEl,
  userList,
} from './elements.js';
import { refreshMyAvatarButton } from './avatar.js';
import { requestNotificationPermission, trySubscribePush } from './notifications.js';
import { socket } from './socket.js';
import { myClientId, roomFromUrl, state } from './state.js';
import { escapeHtml } from './text.js';

if (roomFromUrl()) roomInput.value = roomFromUrl();

// 로그인 화면에 "지금 활동 중이거나 기록이 있는 방" 목록을 보여줌 — 방 이름을
// 정확히 몰라도 골라서 들어갈 수 있게.
async function loadRoomList() {
  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    roomListEl.innerHTML = rooms
      .map(
        (r) =>
          `<button type="button" class="room-item" data-room="${escapeHtml(r.name)}">${escapeHtml(r.name)}${
            r.activeUsers ? ` · ${r.activeUsers}명 접속중` : ''
          }</button>`
      )
      .join('');
  } catch {
    roomListEl.innerHTML = '';
  }
}
loadRoomList();

roomListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.room-item');
  if (btn) roomInput.value = btn.dataset.room;
});

// 새로고침 시 로그인 화면이 잠깐이라도 보이지 않도록, 저장된 닉네임이 있으면
// 곧바로 채팅 화면을 보여주고 뒤에서 재입장을 시도함.
if (state.nickname) {
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
}

// 서버에 비밀번호가 설정되어 있을 때만 입력칸을 보여주고, 백그라운드 푸시 공개키를 받아둠
fetch('/api/config')
  .then((res) => res.json())
  .then(({ pinRequired, pushPublicKey: key, gifEnabled }) => {
    if (pinRequired) pinInput.classList.remove('hidden');
    gifBtn.classList.toggle('hidden', !gifEnabled); // 서버에 GIPHY 키가 있을 때만 GIF 버튼을 보여줌
    state.pushPublicKey = key || null;
    // 알림 권한이 이미 "허용"인 상태로 새로고침한 경우, 페이지 로드 시점의
    // 구독 시도는 이 fetch가 끝나기 전이라 공개키가 아직 없어서 건너뛰었을 수
    // 있음 — 키가 도착한 지금 다시 시도함.
    if (state.pushPublicKey && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      trySubscribePush();
    }
  })
  .catch(() => {});

function updateRoomLabel(room) {
  roomLabel.textContent = room && room !== DEFAULT_ROOM ? `OrisChat · ${room}` : 'OrisChat';
}

function updateUrlForRoom(room) {
  const url = room && room !== DEFAULT_ROOM ? `${location.pathname}?room=${encodeURIComponent(room)}` : location.pathname;
  history.replaceState(null, '', url);
}

function join() {
  const name = nicknameInput.value.trim();
  if (!name) {
    nicknameInput.focus();
    return;
  }
  requestNotificationPermission(); // 버튼 클릭(사용자 제스처) 시점에 물어봐야 브라우저가 허용함
  state.nickname = name;
  state.pin = pinInput.value;
  state.room = roomInput.value.trim().slice(0, 30);
  joinError.classList.add('hidden');
  socket.emit('join', { nickname: name, clientId: myClientId, pin: state.pin, room: state.room });
}

joinBtn.addEventListener('click', join);
[nicknameInput, roomInput, pinInput].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
});

// 소켓이 (재)연결될 때마다 실행됨 — 페이지를 새로고침한 첫 연결이든, 네트워크가
// 끊겼다 다시 붙은 재연결이든 동일하게 저장된 닉네임/clientId/방으로 자동 (재)입장함.
socket.on('connect', () => {
  if (state.nickname) {
    socket.emit('join', { nickname: state.nickname, clientId: myClientId, pin: state.pin, room: state.room });
  }
});

socket.on('joined', ({ nickname, room }) => {
  const firstTime = !state.hasJoined;
  state.nickname = nickname;
  state.room = room;
  state.hasJoined = true;
  state.latestMessageTime = 0;
  state.roomMinReadTime = 0;
  sessionStorage.setItem(NICKNAME_KEY, nickname);
  sessionStorage.setItem(PIN_KEY, state.pin);
  sessionStorage.setItem(ROOM_KEY, room);
  updateRoomLabel(room);
  updateUrlForRoom(room);
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  refreshMyAvatarButton();
  if (firstTime) {
    messageInput.focus();
  }
});

socket.on('join-error', (msg) => {
  // 자동 재입장 시도가 실패한 경우(비밀번호가 바뀐 등)도 포함 — 다시 입력받아야 함
  state.hasJoined = false;
  sessionStorage.removeItem(NICKNAME_KEY);
  sessionStorage.removeItem(PIN_KEY);
  chatScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  joinError.textContent = msg;
  joinError.classList.remove('hidden');
  // 닉네임이 겹친 경우 등: 방금 쓰던 닉네임을 채워두고 바로 고칠 수 있게 함
  if (!nicknameInput.value) nicknameInput.value = state.nickname;
  nicknameInput.focus();
  nicknameInput.select();
});

socket.on('user-list', (users) => {
  state.roomUsers = users;
  userList.innerHTML = '';
  users.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    userList.appendChild(li);
  });
});
