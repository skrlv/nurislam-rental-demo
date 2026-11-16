import { getCars, getStorageStatus, availability, createRequest, subscribe, formatDateTime, parseLocalDateTime, defaultPeriod, toLocalInput, durationLabel, validatePeriod } from './store.js';
import { initChat } from './chat.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icons = {
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>',
};
const eventNames = { wedding: 'Свадьба', meeting: 'Деловая встреча', special: 'Особый случай', '': 'Другое событие' };
const state = { mode: 'hours', filter: 'all', checkedRange: null, request: null, storageError: false, returnCarId: null };
const form = $('#availability-form');
const startInput = $('#start');
const endInput = $('#end');
const carSelect = $('#car-select');
const eventSelect = $('#event');
const message = $('#form-message');
const dialog = $('#request-dialog');
const originalRequestContent = $('#request-content').innerHTML;
let toastTimer;
let chat = null;
const motionBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

function setMessage(text, type = '') {
  message.textContent = text;
  message.className = `form-message${type ? ` is-${type}` : ''}`;
}

function toast(text) {
  clearTimeout(toastTimer);
  const node = $('#toast');
  node.textContent = text;
  node.classList.add('is-visible');
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 4200);
}

function currentRange({ future = false } = {}) {
  return validatePeriod(parseLocalDateTime(startInput.value), parseLocalDateTime(endInput.value), { future });
}

function updateDuration() {
  try {
    const range = currentRange();
    $('#period-duration').textContent = durationLabel(range.start, range.end);
  } catch {
    $('#period-duration').textContent = 'Проверьте период';
  }
}

function invalidateAvailability() {
  state.checkedRange = null;
  updateDuration();
  setMessage('Период изменён. Проверьте доступность для выбранных дат.');
  renderCars();
}

function setMode(mode, { preserveStart = true } = {}) {
  if (!['hours', 'day', 'days'].includes(mode)) mode = 'hours';
  state.mode = mode;
  const fallback = defaultPeriod(mode);
  let start = fallback.start;
  if (preserveStart) {
    try { const parsed = parseLocalDateTime(startInput.value); if (Date.parse(parsed) > Date.now()) start = parsed; } catch { /* Use a valid future default. */ }
  }
  const duration = mode === 'day' ? 86400000 : mode === 'days' ? 259200000 : 14400000;
  startInput.value = toLocalInput(start);
  endInput.value = toLocalInput(new Date(Date.parse(start) + duration).toISOString());
  $$('.mode-button').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  invalidateAvailability();
}

function renderCarSelect() {
  const current = carSelect.value;
  const cars = getCars().filter(car => car.active);
  carSelect.innerHTML = '<option value="">Любая модель</option>' + cars.map(car => `<option value="${escapeHtml(car.id)}">${escapeHtml(car.name)}</option>`).join('');
  carSelect.value = cars.some(car => car.id === current) ? current : '';
}

function renderCars() {
  const cars = getCars().filter(car => car.active);
  const filtered = cars.filter(car => (state.filter === 'all' || car.category === state.filter) && (!carSelect.value || car.id === carSelect.value));
  const status = getStorageStatus();
  state.storageError = !status.available;
  if (status.message) setMessage(status.message, 'error');
  let freeCount = 0;
  $('#car-grid').innerHTML = filtered.map((car, index) => {
    let availabilityText = 'Доступность по вашим датам';
    let availabilityClass = '';
    let action = 'check';
    let actionText = 'Выбрать автомобиль';
    if (state.checkedRange && status.available) {
      try {
        const result = availability(car.id, state.checkedRange.start, state.checkedRange.end);
        if (result.available) {
          availabilityText = 'Свободен в тестовом календаре';
          availabilityClass = ' is-available';
          action = 'request';
          actionText = 'Тестовая заявка';
          freeCount += 1;
        } else {
          availabilityText = 'Занят на выбранный период';
          availabilityClass = ' is-busy';
          action = 'dates';
          actionText = 'Выбрать другие даты';
        }
      } catch (error) {
        availabilityText = 'Не удалось проверить календарь';
        setMessage(error.message, 'error');
      }
    }
    const image = /^assets\/images\/[a-z0-9-]+\.(webp|png|jpe?g)$/.test(car.image || '') ? car.image : 'assets/images/hero.webp';
    const responsiveImage = ['maybach', 'business'].includes(car.id) && image === `assets/images/${car.id}.webp`
      ? ` srcset="assets/images/${car.id}-480.webp 480w, assets/images/${car.id}-800.webp 800w" sizes="(max-width: 700px) 90vw, 33vw"` : '';
    return `<article class="car-card">
      <div class="car-image-wrap"><img src="${escapeHtml(image)}"${responsiveImage} alt="${escapeHtml(car.name)} — иллюстративный автомобиль" width="800" height="540" loading="lazy" decoding="async"><span class="car-image-number">0${index + 1} / АВТОМОБИЛИ</span></div>
      <div class="car-content"><p class="car-category">${car.category === 'wedding' ? 'Для особенных событий' : 'Комфорт в каждой детали'}</p><h3>${escapeHtml(car.name)}</h3><p class="car-description">${escapeHtml(car.description)}</p><p class="car-availability${availabilityClass}">${icons.calendar}<span>${escapeHtml(availabilityText)}</span></p><button class="button button-outline" type="button" data-car-action="${action}" data-car-id="${escapeHtml(car.id)}"${state.storageError ? ' disabled' : ''}>${actionText}${icons.arrow}</button></div>
    </article>`;
  }).join('');
  if (!filtered.length) {
    $('#car-grid').innerHTML = `<div class="empty-catalog"><p>Для выбранного фильтра нет автомобилей.</p><button type="button" class="button button-outline" data-reset-filters>Показать все автомобили</button></div>`;
  }
  const checked = state.checkedRange;
  $('#catalog-status').textContent = checked
    ? `${formatDateTime(checked.start)} — ${formatDateTime(checked.end)} · свободно ${freeCount} из ${filtered.length} · МСК`
    : 'Выберите период, чтобы проверить тестовый календарь';
}

function setFilter(filter) {
  state.filter = filter;
  $$('.filter-button').forEach(button => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderCars();
}

function showBooking(carId = null) {
  if (carId) carSelect.value = carId;
  $('#booking').scrollIntoView({ behavior: motionBehavior(), block: 'center' });
  setMessage('Проверьте выбранный период, затем создайте тестовую заявку.');
  setTimeout(() => startInput.focus({ preventScroll: true }), motionBehavior() === 'auto' ? 0 : 350);
}

function showRequest(carId) {
  const car = getCars().find(item => item.id === carId);
  if (!car || !state.checkedRange) { showBooking(carId); return; }
  try {
    const range = currentRange({ future: true });
    if (range.start !== state.checkedRange.start || range.end !== state.checkedRange.end) {
      invalidateAvailability();
      showBooking(carId);
      return;
    }
    if (!availability(carId, range.start, range.end).available) {
      renderCars();
      toast('Автомобиль уже занят. Выберите другое время.');
      return;
    }
    state.request = { carId, start: range.start, end: range.end, eventType: eventNames[eventSelect.value] || 'Другое событие' };
    state.returnCarId = carId;
    $('#request-content').innerHTML = originalRequestContent;
    $('#request-summary').innerHTML = `<strong>${escapeHtml(car.name)}</strong><div class="summary-row"><span>Начало</span><span>${escapeHtml(formatDateTime(range.start))}</span></div><div class="summary-row"><span>Окончание</span><span>${escapeHtml(formatDateTime(range.end))}</span></div><div class="summary-row"><span>Период</span><span>${escapeHtml(durationLabel(range.start, range.end))} · МСК</span></div><div class="summary-row"><span>Событие</span><span>${escapeHtml(state.request.eventType)}</span></div>`;
    $('#request-form').addEventListener('submit', handleRequest);
    dialog.showModal();
    document.body.classList.add('has-dialog');
  } catch (error) {
    showBooking();
    setMessage(error.message, 'error');
  }
}

function handleRequest(event) {
  event.preventDefault();
  if (!state.request) return;
  const submitButton = $('button[type="submit"]', event.currentTarget);
  submitButton.disabled = true;
  try {
    const customerName = $('#test-name').value.trim();
    if (!customerName) throw new Error('Укажите вымышленное имя для теста.');
    const reservation = createRequest({ ...state.request, customerName });
    state.request = null;
    $('#request-content').innerHTML = `<div class="request-success"><div class="success-mark">${icons.check}</div><p class="eyebrow">Демонстрация работает</p><h2 id="request-title">Тестовая заявка создана</h2><p>Она сохранена только в вашем браузере и никому не отправлена. Реальный автомобиль не забронирован.</p><p>Откройте демо CRM, чтобы подтвердить заявку и увидеть изменение занятости.</p><p class="success-id">ЗАЯВКА ${escapeHtml(reservation.id.slice(0, 8).toUpperCase())}</p><a href="crm.html" class="button button-primary">Открыть демо CRM ${icons.arrow}</a><button class="button button-outline" type="button" data-close-dialog>Продолжить просмотр</button></div>`;
    $('[data-close-dialog]', dialog).addEventListener('click', () => dialog.close());
    $('.request-success h2', dialog).setAttribute('tabindex', '-1');
    $('.request-success h2', dialog).focus();
    renderCars();
  } catch (error) {
    $('#request-error').textContent = error.message;
    submitButton.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const range = currentRange({ future: true });
    const status = getStorageStatus();
    if (!status.available) throw new Error(status.message);
    state.checkedRange = { start: range.start, end: range.end };
    renderCars();
    setMessage(`Период проверен: ${durationLabel(range.start, range.end)}. Результаты — в каталоге ниже.`, 'success');
    $('#catalog').scrollIntoView({ behavior: motionBehavior(), block: 'start' });
  } catch (error) {
    state.checkedRange = null;
    renderCars();
    setMessage(error.message, 'error');
  }
});

$$('.mode-button').forEach(button => button.addEventListener('click', () => { setMode(button.dataset.mode); chat?.refreshContext(); }));
startInput.addEventListener('change', () => { invalidateAvailability(); chat?.refreshContext(); });
endInput.addEventListener('change', () => { invalidateAvailability(); chat?.refreshContext(); });
eventSelect.addEventListener('change', () => chat?.refreshContext());
carSelect.addEventListener('change', () => { state.checkedRange = null; renderCars(); setMessage('Проверьте период для выбранного автомобиля.'); chat?.refreshContext(); });
$$('.filter-button').forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
$('#car-grid').addEventListener('click', event => {
  const action = event.target.closest('[data-car-action]');
  if (action) {
    if (action.dataset.carAction === 'request') showRequest(action.dataset.carId);
    else showBooking(action.dataset.carId);
  }
  if (event.target.closest('[data-reset-filters]')) { carSelect.value = ''; setFilter('all'); }
});
$('.dialog-close', dialog).addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
dialog.addEventListener('close', () => {
  state.request = null;
  document.body.classList.remove('has-dialog');
  const returnButton = $$('[data-car-id]').find(button => button.dataset.carId === state.returnCarId);
  if (returnButton) returnButton.focus({ preventScroll: true });
  state.returnCarId = null;
});

const menu = $('#menu-toggle');
const nav = $('#site-nav');
function closeMenu() { menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', 'Открыть меню'); nav.classList.remove('is-open'); }
menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); menu.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню'); nav.classList.toggle('is-open', open); });
$$('a', nav).forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
document.addEventListener('click', event => { if (!event.target.closest('.site-header')) closeMenu(); });

renderCarSelect();
setMode('hours', { preserveStart: false });
setMessage('Выберите период, чтобы увидеть свободные автомобили.');
const minimum = toLocalInput(Date.now());
startInput.min = minimum;
endInput.min = minimum;
const initialStorage = getStorageStatus();
if (initialStorage.message) setMessage(initialStorage.message, 'error');
subscribe(() => { renderCarSelect(); renderCars(); });

chat = initChat({
  getContext: () => {
    let range = {};
    try { const valid = currentRange(); range = { start: valid.start, end: valid.end }; } catch { /* The assistant can ask for valid dates. */ }
    return { ...range, mode: state.mode, carId: carSelect.value, eventType: eventSelect.value };
  },
  onApplyPeriod: ({ mode, start, end, eventType } = {}) => {
    if (mode) setMode(mode);
    if (start) startInput.value = toLocalInput(start);
    if (end) endInput.value = toLocalInput(end);
    const eventKey = eventType && Object.hasOwn(eventNames, eventType)
      ? eventType : Object.keys(eventNames).find(key => eventNames[key] === eventType);
    if (eventKey) eventSelect.value = eventKey;
    invalidateAvailability();
    showBooking();
    toast('Период подставлен в форму. Проверьте доступность.');
  },
  onSelectCar: carId => {
    if (!getCars().some(car => car.id === carId && car.active)) return;
    carSelect.value = carId;
    setFilter('all');
    invalidateAvailability();
    showBooking(carId);
  },
});
$('#ask-assistant').addEventListener('click', () => {
  if (chat?.open) chat.open();
  else $('.chat-launcher, [data-chat-open], #chat-toggle')?.click();
});
