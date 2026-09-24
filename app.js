const THEME_STORAGE_KEY = 'school-tools-v2-theme';
const majorOffices = ['教務處', '學務處', '體育組', '總務處', '輔導處', '特教辦公室', '七導', '八導', '九導', '三專', '五專'];

const state = { teachers: [], office: 'all' };
const elements = {
  body: document.body,
  theme: document.getElementById('btnThemeToggle'),
  search: document.getElementById('searchInput'),
  clearSearch: document.getElementById('btnClearSearch'),
  filters: document.getElementById('filterTags'),
  stats: document.getElementById('statsCount'),
  skeleton: document.getElementById('skeletonLoader'),
  cards: document.getElementById('cardsGrid'),
  modal: document.getElementById('modalOverlay'),
  openModal: document.getElementById('btnOpenModal'),
  closeModal: document.getElementById('btnCloseModal'),
  cancel: document.getElementById('btnCancel'),
  form: document.getElementById('teacherForm'),
  submit: document.getElementById('btnSubmit'),
  notice: document.getElementById('noticeOverlay'),
  noticeMessage: document.getElementById('noticeMessage'),
  closeNotice: document.getElementById('btnCloseNotice'),
  toast: document.getElementById('toast')
};

function setTheme(theme) {
  const isDark = theme === 'dark';
  elements.body.classList.toggle('dark-theme', isDark);
  elements.theme.innerHTML = `<i class="fa-solid fa-${isDark ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
  elements.theme.setAttribute('aria-label', `切換${isDark ? '淺色' : '深色'}模式`);
}

function getSavedTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* UI remains usable without storage. */ }
}

function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-Hant');
}

function matchesOffice(teacher, office) {
  if (office === 'all') return true;
  if (office === '其他') return !majorOffices.some((item) => teacher.office.includes(item));
  return teacher.office.includes(office);
}

function filteredTeachers() {
  const query = normalize(elements.search.value);
  return state.teachers.filter((teacher) => {
    if (!matchesOffice(teacher, state.office)) return false;
    if (!query) return true;
    return ['name', 'office', 'title', 'lineName', 'subject', 'ext']
      .some((field) => normalize(teacher[field]).includes(query));
  });
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function createTeacherCard(teacher, index) {
  const card = document.createElement('article');
  card.className = 'teacher-card';
  card.style.animationDelay = `${Math.min(index * 0.03, 0.5)}s`;

  const header = document.createElement('div');
  header.className = 'card-header';
  const identity = document.createElement('div');
  identity.append(createTextElement('h2', 'teacher-name', teacher.name));
  if (teacher.inSmallGroup === '已加入') {
    const joined = createTextElement('span', 'badge-status-joined', '義中人');
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-users';
    icon.setAttribute('aria-hidden', 'true');
    joined.prepend(icon);
    const wrap = document.createElement('div');
    wrap.className = 'joined-wrap';
    wrap.append(joined);
    identity.append(wrap);
  }
  const badges = document.createElement('div');
  badges.className = 'badges-container';
  const office = createTextElement('span', 'badge-office', teacher.office || '未定處室');
  office.dataset.office = teacher.office || '';
  badges.append(office);
  if (teacher.title) badges.append(createTextElement('span', 'badge-title', teacher.title));
  header.append(identity, badges);

  const lineBox = document.createElement('div');
  lineBox.className = 'line-info-box';
  const lineLabel = document.createElement('div');
  lineLabel.className = 'line-label-wrapper';
  const lineIcon = document.createElement('i');
  lineIcon.className = 'fa-brands fa-line line-icon-brand';
  lineIcon.setAttribute('aria-hidden', 'true');
  lineLabel.append(lineIcon, createTextElement('span', teacher.lineName ? 'line-name-text' : 'line-name-empty', teacher.lineName || '尚未填寫'));
  lineBox.append(lineLabel);
  if (teacher.lineName) {
    const copy = document.createElement('button');
    copy.className = 'btn-copy';
    copy.type = 'button';
    copy.setAttribute('aria-label', `複製 ${teacher.name} 的 LINE 名稱`);
    copy.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i>';
    copy.addEventListener('click', () => copyLineName(teacher.lineName));
    lineBox.append(copy);
  }

  const footer = document.createElement('div');
  footer.className = 'card-footer';
  footer.innerHTML = '<div class="footer-item"><i class="fa-solid fa-book-open" aria-hidden="true"></i></div><div class="footer-item"><i class="fa-solid fa-phone" aria-hidden="true"></i></div>';
  footer.children[0].append(createTextElement('span', '', teacher.subject || '無科目'));
  footer.children[1].append(createTextElement('span', '', `分機: ${teacher.ext || '無'}`));
  card.append(header, lineBox, footer);
  return card;
}

function renderCards() {
  const teachers = filteredTeachers();
  const query = normalize(elements.search.value);
  elements.cards.replaceChildren();
  elements.clearSearch.classList.toggle('visible', Boolean(query));
  elements.stats.textContent = query || state.office !== 'all'
    ? `篩選出 ${teachers.length} 筆符合的資料 (全部共 ${state.teachers.length} 筆)`
    : `目前共計 ${state.teachers.length} 筆測試資料`;

  if (!teachers.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<i class="fa-solid fa-magnifying-glass-minus empty-icon" aria-hidden="true"></i><p class="empty-title">查無符合的同仁資料</p><p>請更換關鍵字或清除篩選條件</p>';
    elements.cards.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  teachers.forEach((teacher, index) => fragment.append(createTeacherCard(teacher, index)));
  elements.cards.append(fragment);
}

async function copyLineName(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('input');
    input.value = text;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  showToast(`已複製 LINE 名字：${text}`);
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2000);
}

function openModal() {
  elements.form.reset();
  elements.modal.classList.add('active');
  elements.modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  document.getElementById('formName').focus();
}

function closeModal() {
  elements.modal.classList.remove('active');
  elements.modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  elements.openModal.focus();
}

function closeNotice() {
  elements.notice.classList.remove('active');
  elements.notice.setAttribute('aria-hidden', 'true');
  elements.openModal.focus();
}

async function submitForm(event) {
  event.preventDefault();
  if (!elements.form.reportValidity()) return;
  const payload = {
    name: document.getElementById('formName').value.trim(),
    office: document.getElementById('formOffice').value,
    title: document.getElementById('formTitle').value.trim(),
    lineName: document.getElementById('formLineName').value.trim(),
    subject: document.getElementById('formSubject').value.trim(),
    ext: document.getElementById('formExt').value.trim(),
    inSmallGroup: document.getElementById('formInSmallGroup').value
  };
  elements.submit.disabled = true;
  const result = await updateTeacher(payload);
  elements.submit.disabled = false;
  closeModal();
  elements.noticeMessage.textContent = result.message;
  elements.notice.classList.add('active');
  elements.notice.setAttribute('aria-hidden', 'false');
  elements.closeNotice.focus();
}

elements.theme.addEventListener('click', () => {
  const next = elements.body.classList.contains('dark-theme') ? 'light' : 'dark';
  setTheme(next);
  saveTheme(next);
});
elements.search.addEventListener('input', renderCards);
elements.search.addEventListener('search', renderCards);
elements.clearSearch.addEventListener('click', () => { elements.search.value = ''; renderCards(); elements.search.focus(); });
elements.filters.addEventListener('click', (event) => {
  const button = event.target.closest('.filter-tag');
  if (!button) return;
  elements.filters.querySelectorAll('.filter-tag').forEach((tag) => tag.classList.toggle('active', tag === button));
  state.office = button.dataset.office;
  renderCards();
});
elements.openModal.addEventListener('click', openModal);
elements.closeModal.addEventListener('click', closeModal);
elements.cancel.addEventListener('click', closeModal);
elements.modal.addEventListener('click', (event) => { if (event.target === elements.modal) closeModal(); });
elements.form.addEventListener('submit', submitForm);
elements.closeNotice.addEventListener('click', closeNotice);
elements.notice.addEventListener('click', (event) => { if (event.target === elements.notice) closeNotice(); });
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (elements.notice.classList.contains('active')) closeNotice();
  else if (elements.modal.classList.contains('active')) closeModal();
});

async function initialize() {
  setTheme(getSavedTheme() === 'dark' ? 'dark' : 'light');
  try {
    state.teachers = await loadTeachers();
    renderCards();
  } catch {
    elements.stats.textContent = '無法載入測試資料';
  } finally {
    elements.skeleton.hidden = true;
    elements.cards.hidden = false;
  }
}

initialize();
