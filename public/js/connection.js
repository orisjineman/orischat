import { connectionBanner } from './elements.js';
import { socket } from './socket.js';

// 서버가 잠들어 있거나 네트워크가 끊겼을 때, 먹통처럼 보이지 않게 안내함
const LOST_TEXT = '연결이 끊겼어요. 다시 연결하는 중...';

socket.on('disconnect', () => {
  connectionBanner.textContent = LOST_TEXT;
  connectionBanner.classList.remove('hidden');
});

socket.on('connect_error', () => {
  connectionBanner.classList.remove('hidden');
});

socket.on('connect', () => {
  connectionBanner.classList.add('hidden');
});
