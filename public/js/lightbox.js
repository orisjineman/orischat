import { imageLightbox, lightboxImg, lightboxCloseBtn } from './elements.js';

// 사진/스티커 확대 보기
export function openLightbox(src) {
  lightboxImg.src = src;
  imageLightbox.classList.remove('hidden');
}

function closeLightbox() {
  imageLightbox.classList.add('hidden');
  lightboxImg.src = '';
}

imageLightbox.addEventListener('click', closeLightbox);
lightboxCloseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  closeLightbox();
});
// 이미지 자체를 클릭했을 때는(배경 클릭과 달리) 안 닫히게 — 실수로 닫히는 것 방지
lightboxImg.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !imageLightbox.classList.contains('hidden')) closeLightbox();
});
