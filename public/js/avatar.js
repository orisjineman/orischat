import { AVATAR_MAX_LENGTH } from './constants.js';
import { avatarBtn, avatarEditBtn, avatarFileInput } from './elements.js';
import { resizeImageSquare } from './imageFile.js';
import { openLightbox } from './lightbox.js';
import { socket } from './socket.js';
import { avatarVersions, state } from './state.js';
import { nicknameColor, nicknameInitial } from './text.js';

function avatarUrl(nickname) {
  return `/avatar/${encodeURIComponent(nickname)}?v=${avatarVersions.get(nickname) || 0}`;
}

// 프로필 사진(닉네임 기준)이 있으면 그걸, 없으면(또는 로드 실패하면) 이니셜
// 배지를 보여주는 엘리먼트를 만듦. avatar-updated 이벤트가 오면 이 함수로
// 다시 만들어서 교체함.
export function createAvatarEl(nickname, { clickable = true } = {}) {
  const img = document.createElement('img');
  img.className = 'msg-avatar msg-avatar-img';
  img.alt = '';
  img.dataset.avatarNickname = nickname;
  img.src = avatarUrl(nickname);
  if (clickable) {
    img.classList.add('avatar-clickable');
    // 사진이 없어서 onerror로 이니셜 배지로 바뀌기 전까지만 클릭이 유효함
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(img.src);
    });
  }
  img.onerror = () => {
    const span = document.createElement('span');
    span.className = 'msg-avatar';
    span.style.background = nicknameColor(nickname);
    span.textContent = nicknameInitial(nickname);
    span.dataset.avatarNickname = nickname;
    img.replaceWith(span);
  };
  return img;
}

// 화면에 떠 있는 해당 닉네임의 아바타를 전부 새로 만들어 교체
function replaceAvatars(nickname) {
  document.querySelectorAll(`[data-avatar-nickname="${CSS.escape(nickname)}"]`).forEach((el) => {
    el.replaceWith(createAvatarEl(nickname));
  });
}

// 내 메시지 말풍선엔 원래 닉네임/아바타를 안 보여줘서(색으로만 구분), 프로필
// 사진을 올려도 확인할 방법이 없었음 — 헤더 버튼 자체가 내 현재 프로필 사진을
// 보여주게 해서 바로 확인 가능하게 함.
export function refreshMyAvatarButton() {
  if (!state.nickname) return;
  avatarBtn.innerHTML = '';
  // 버튼 자체는 "크게 보기" 클릭을 담당하므로, 내부 이미지는 클릭 핸들러가
  // 따로 없는 버전으로 만듦 (이벤트 버블링이 막히면 버튼 클릭이 씹힘)
  const el = createAvatarEl(state.nickname, { clickable: false });
  el.classList.add('avatar-btn-img');
  avatarBtn.appendChild(el);
}

avatarBtn.addEventListener('click', () => {
  if (!state.nickname) return;
  // 사진을 설정 안 했으면(이니셜 배지만 있으면) 확대해서 볼 게 없으니 바로
  // 사진 설정 화면으로 보냄
  if (!avatarBtn.querySelector('img')) {
    avatarFileInput.click();
    return;
  }
  openLightbox(avatarUrl(state.nickname));
});

avatarEditBtn.addEventListener('click', () => avatarFileInput.click());

avatarFileInput.addEventListener('change', async () => {
  const file = avatarFileInput.files[0];
  avatarFileInput.value = '';
  if (!file) return;

  try {
    let dataUrl = await resizeImageSquare(file, 200, 0.85);
    if (dataUrl.length > AVATAR_MAX_LENGTH) {
      dataUrl = await resizeImageSquare(file, 120, 0.7); // 그래도 크면 한 번 더 압축
    }
    if (dataUrl.length > AVATAR_MAX_LENGTH) {
      alert('프로필 사진 용량이 너무 큽니다. 더 작은 사진을 선택해주세요.');
      return;
    }
    socket.emit('set-avatar', { content: dataUrl });
    // 서버 브로드캐스트가 오기 전에도 내 화면엔 바로 반영되게(체감 지연 줄이기)
    avatarVersions.set(state.nickname, Date.now());
    replaceAvatars(state.nickname);
    refreshMyAvatarButton();
  } catch {
    alert('이미지를 처리하지 못했습니다.');
  }
});

socket.on('avatar-updated', ({ nickname, updatedAt }) => {
  avatarVersions.set(nickname, updatedAt);
  if (nickname === state.nickname) refreshMyAvatarButton();
  replaceAvatars(nickname);
});
