import { socket } from './socket.js';

// 짧은 시간에 너무 많이 보내면 서버가 알려줌 (스팸/도배 방지)
const rateLimitToast = document.createElement('div');
rateLimitToast.id = 'rate-limit-toast';
rateLimitToast.textContent = '너무 빨라요! 잠시 후 다시 시도해주세요.';
document.body.appendChild(rateLimitToast);

let rateLimitToastTimer = null;
socket.on('rate-limited', () => {
  rateLimitToast.classList.add('show');
  clearTimeout(rateLimitToastTimer);
  rateLimitToastTimer = setTimeout(() => rateLimitToast.classList.remove('show'), 2000);
});

socket.on('upload-error', (msg) => {
  alert(msg);
});
