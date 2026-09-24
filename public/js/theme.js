import { THEME_KEY } from './constants.js';
import { themeToggleBtn } from './elements.js';

// 시스템 설정보다 수동 선택이 우선 적용됨
const THEME_OPTIONS = [
  { value: '', icon: '🌓', label: '시스템 설정' },
  { value: 'light', icon: '☀️', label: '라이트' },
  { value: 'dark', icon: '🌙', label: '다크' },
  { value: 'intellij', icon: '🧠', label: 'IntelliJ' },
  { value: 'excel', icon: '📊', label: 'Excel' },
];

const themePicker = document.createElement('div');
themePicker.id = 'theme-picker';
themePicker.className = 'hidden';
themePicker.innerHTML = THEME_OPTIONS.map(
  (o) => `<button type="button" class="theme-option" data-theme-value="${o.value}">${o.icon} ${o.label}</button>`
).join('');
document.body.appendChild(themePicker);

function applyTheme(theme) {
  const opt = THEME_OPTIONS.find((o) => o.value === (theme || '')) || THEME_OPTIONS[0];
  if (opt.value) document.documentElement.setAttribute('data-theme', opt.value);
  else document.documentElement.removeAttribute('data-theme');
  themeToggleBtn.textContent = opt.icon;
  themePicker.querySelectorAll('.theme-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeValue === opt.value);
  });
}

applyTheme(localStorage.getItem(THEME_KEY));

themeToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = themePicker.classList.contains('hidden');
  if (opening) {
    const rect = themeToggleBtn.getBoundingClientRect();
    themePicker.style.top = `${rect.bottom + window.scrollY + 6}px`;
    themePicker.style.right = `${window.innerWidth - rect.right}px`;
  }
  themePicker.classList.toggle('hidden');
});

themePicker.addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-option');
  if (!btn) return;
  const value = btn.dataset.themeValue;
  if (value) localStorage.setItem(THEME_KEY, value);
  else localStorage.removeItem(THEME_KEY);
  applyTheme(value);
  themePicker.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!themePicker.classList.contains('hidden') && e.target !== themeToggleBtn && !themePicker.contains(e.target)) {
    themePicker.classList.add('hidden');
  }
});
