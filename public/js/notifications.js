import { notifyBtn } from './elements.js';
import { socket } from './socket.js';
import { state } from './state.js';

// --- 백그라운드 푸시 알림 (탭/브라우저를 닫아도 알림 받기) ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export async function trySubscribePush() {
  if (!state.pushPublicKey || state.pushSubscribed) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.pushPublicKey),
      });
    }
    socket.emit('push-subscribe', subscription.toJSON());
    state.pushSubscribed = true;
  } catch (err) {
    console.warn('푸시 구독 실패(포그라운드 알림만 동작):', err);
  }
}

// 알림 버튼 상태 표시. sessionStorage로 세션이 자동 복원되는 경우(재입장 버튼을
// 직접 안 누름)에는 권한 요청 기회가 없었을 수 있어서, 버튼을 눌러 언제든
// 다시 요청할 수 있게 함.
function updateNotifyButton() {
  if (typeof Notification === 'undefined') {
    notifyBtn.classList.add('hidden');
    return;
  }
  if (Notification.permission === 'granted') {
    notifyBtn.textContent = '🔔 알림 켜짐';
    notifyBtn.classList.add('granted');
    trySubscribePush();
  } else if (Notification.permission === 'denied') {
    notifyBtn.textContent = '🔕 알림 차단됨 (브라우저 설정에서 허용해주세요)';
    notifyBtn.classList.remove('granted');
  } else {
    notifyBtn.textContent = '🔕 알림 켜기';
    notifyBtn.classList.remove('granted');
  }
}

export function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(updateNotifyButton);
  }
}

notifyBtn.addEventListener('click', () => {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(updateNotifyButton);
  } else {
    updateNotifyButton(); // denied/granted면 그냥 현재 상태 문구만 다시 보여줌(+granted면 푸시 재구독 시도)
  }
});

updateNotifyButton();

// 탭이 안 보일 때 새 메시지가 오면 브라우저 알림을 띄움 (백그라운드 푸시가 안 될 때의 대체 수단).
// 단, @멘션은 "우선 알림"이라 탭을 보고 있어도 띄움.
export function maybeNotify(payload) {
  if (state.pushSubscribed) return; // 푸시가 켜져 있으면 Service Worker가 알림을 담당함
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (payload.mine) return;

  const isMention = Array.isArray(payload.mentions) && payload.mentions.includes(state.nickname);
  if (!isMention && !document.hidden) return;

  // 메시지 내용은 알림에 노출하지 않음 (잠금화면 등에서 다른 사람이 볼 수 있어서)
  const title = isMention
    ? `${payload.nickname || '누군가'}님이 회원님을 언급했습니다`
    : `${payload.nickname || '누군가'}님이 메시지를 보냈습니다`;
  try {
    const n = new Notification(title, {
      body: '확인하려면 클릭하세요',
      tag: 'orischat-message',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // 알림 생성 실패는 무시 (필수 기능 아님)
  }
}
