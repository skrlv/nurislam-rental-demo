import { getCars, getReservations, getStorageStatus, createReservation, updateReservation, updateCar, resetDemo, subscribe, defaultPeriod, toLocalInput, parseLocalDateTime, formatDateTime, durationLabel, STATUS_LABELS } from './store.js';

const $ = selector => document.querySelector(selector);
const DAY = 86400000, OFFSET = 10800000;
let activeTab = 'calendar', weekOffset = 0, toastTimer;
const descriptions = {
  calendar: ['Календарь аренды', 'Весь автопарк и занятость — в одном месте.'],
  requests: ['Заявки и записи', 'Управляйте тестовыми обращениями и статусами.'],
  fleet: ['Автомобили', 'Настройте демонстрационный каталог.'],
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, action) {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const node = $('#toast');
  node.textContent = message; node.className = `toast${error ? ' error' : ''}`; node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 7000 : 4500);
}

function run(action, success) {
  try { action(); if (success) toast(success); }
  catch (error) { toast(error.message || 'Не удалось сохранить изменение.', true); }
}

function setTab(name) {
  activeTab = name;
  document.querySelectorAll('[data-tab]').forEach(node => {
    const active = node.dataset.tab === name;
    node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active));
  });
  for (const panel of Object.keys(descriptions)) $(`#panel-${panel}`).hidden = panel !== name;
  $('#page-title').textContent = descriptions[name][0];
  $('#page-description').textContent = descriptions[name][1];
}

function monday(now = Date.now()) {
  const localDate = new Date(now + OFFSET).toISOString().slice(0, 10);
  const midnight = Date.parse(`${localDate}T00:00:00+03:00`);
  const day = new Date(midnight + OFFSET).getUTCDay();
  return midnight - ((day + 6) % 7) * DAY;
}

function dateText(time, options) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', ...options }).format(new Date(time));
}

function renderCalendar(cars, reservations) {
  const weekStart = monday() + weekOffset * 7 * DAY;
  $('#week-label').textContent = `${dateText(weekStart, { day: 'numeric', month: 'short' })} — ${dateText(weekStart + 6 * DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const root = $('#calendar-grid'); root.replaceChildren();
  root.append(el('div', 'calendar-corner', 'АВТОМОБИЛЬ / ДАТА'));
  const today = toLocalInput(new Date().toISOString()).slice(0, 10);
  for (let i = 0; i < 7; i++) {
    const date = weekStart + i * DAY;
    const isToday = toLocalInput(date).slice(0, 10) === today;
    const header = el('div', `calendar-dayhead${isToday ? ' today' : ''}`, dateText(date, { weekday: 'short' }).toUpperCase());
    header.append(el('strong', '', dateText(date, { day: 'numeric' })));
    root.append(header);
  }
  for (const car of cars) {
    const label = el('div', 'calendar-car');
    const image = el('img'); image.src = car.image; image.alt = ''; image.width = 66; image.height = 40; image.loading = 'lazy';
    label.append(image, el('strong', '', car.name), el('span', '', car.active ? 'Демонстрационный авто' : 'Скрыт из каталога'));
    root.append(label);
    for (let i = 0; i < 7; i++) {
      const date = weekStart + i * DAY, end = date + DAY;
      const isToday = toLocalInput(date).slice(0, 10) === today;
      const cell = el('div', `calendar-cell${isToday ? ' today' : ''}`);
      const add = button('+', 'calendar-add', () => openReservation(car.id, date));
      add.setAttribute('aria-label', `Добавить запись: ${car.name}, ${dateText(date, { day: 'numeric', month: 'long' })}`);
      if (!car.active) add.disabled = true;
      cell.append(add);
      const bookings = reservations.filter(item => item.carId === car.id && item.status !== 'cancelled' && item.startAt < end && item.endAt > date).sort((a, b) => a.startAt - b.startAt);
      for (const record of bookings) {
        const from = record.startAt < date ? '00:00' : dateText(record.startAt, { hour: '2-digit', minute: '2-digit' });
        const until = record.endAt >= end ? '24:00' : dateText(record.endAt, { hour: '2-digit', minute: '2-digit' });
        const chip = button('', `booking-chip ${record.status}`, () => {
          $('#request-filter').value = 'all'; setTab('requests'); renderRequests(cars, reservations);
          const card = document.getElementById(`reservation-${record.id}`);
          card?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
          card?.focus({ preventScroll: true });
        });
        chip.append(el('strong', '', `${from}–${until}`), el('span', '', record.isExample ? 'Пример занятости' : record.eventType));
        chip.title = `${STATUS_LABELS[record.status]} · ${record.customerName} · ${formatDateTime(record.start)} — ${formatDateTime(record.end)}`;
        cell.append(chip);
      }
      root.append(cell);
    }
  }
}

function statusAction(record, status, label, className = 'button secondary') {
  return button(label, className, () => run(() => updateReservation(record.id, { status }), status === 'confirmed' ? 'Тестовая заявка подтверждена. Календарь обновлён.' : status === 'cancelled' ? 'Запись отменена. Время снова доступно.' : 'Аренда отмечена завершённой.'));
}

function renderRequests(cars, records) {
  const filter = $('#request-filter').value;
  const list = $('#request-list'); list.replaceChildren();
  const items = records.filter(item => filter === 'all' || item.status === filter).sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return b.createdAt - a.createdAt;
  });
  if (!items.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('strong', '', 'Здесь пока нет записей'), el('p', '', 'Создайте тестовую заявку на сайте или добавьте запись в календаре.'), button('Добавить запись', 'button primary', () => openReservation()));
    list.append(empty); return;
  }
  for (const record of items) {
    const card = el('article', 'request-card'); card.id = `reservation-${record.id}`; card.tabIndex = -1;
    const main = el('div', 'request-main');
    main.append(el('span', `status-tag ${record.status}`, STATUS_LABELS[record.status]), el('strong', '', cars.find(item => item.id === record.carId)?.name || 'Автомобиль'), el('p', '', `${record.isExample ? 'Пример занятости' : record.customerName} · ${record.eventType}`));
    if (record.notes) main.append(el('div', 'request-notes', record.notes));
    const times = el('div', 'request-time');
    times.append(el('strong', '', formatDateTime(record.start)), el('p', '', `до ${formatDateTime(record.end)}`), el('p', '', `${durationLabel(record.start, record.end)} · МСК`));
    const actions = el('div', 'request-actions');
    if (record.status === 'pending') actions.append(statusAction(record, 'confirmed', 'Подтвердить', 'button primary'));
    if (record.status === 'confirmed') actions.append(statusAction(record, 'completed', 'Завершить'));
    if (['pending', 'confirmed', 'blocked'].includes(record.status)) actions.append(statusAction(record, 'cancelled', 'Отменить', 'button danger-soft'));
    if (!actions.children.length) actions.append(el('span', 'request-notes', 'Запись в истории'));
    card.append(main, times, actions); list.append(card);
  }
}

function renderFleet(cars) {
  const root = $('#fleet-grid'); root.replaceChildren();
  for (const car of cars) {
    const card = el('article', 'fleet-card'), image = el('img');
    image.src = car.image; image.alt = `${car.name}, иллюстративное изображение`; image.loading = 'lazy'; image.width = 560; image.height = 340;
    const content = el('div', 'fleet-card-content');
    content.append(el('div', `fleet-status${car.active ? '' : ' inactive'}`, car.active ? 'В каталоге' : 'Скрыт из каталога'), el('h3', '', car.name), el('p', '', car.description));
    const actions = el('div', 'fleet-card-actions');
    actions.append(button('Изменить', 'button secondary', () => openCar(car)), button(car.active ? 'Скрыть' : 'Показать', 'button secondary', () => run(() => updateCar(car.id, { active: !car.active }), car.active ? 'Автомобиль скрыт из демокаталога.' : 'Автомобиль снова виден в демокаталоге.')));
    content.append(actions); card.append(image, content); root.append(card);
  }
}

function render() {
  const cars = getCars(), reservations = getReservations();
  const storage = getStorageStatus();
  $('#storage-warning').hidden = storage.available;
  $('#storage-warning').textContent = storage.message || '';
  $('#stat-cars').textContent = cars.filter(car => car.active).length;
  $('#stat-pending').textContent = reservations.filter(item => item.status === 'pending').length;
  $('#pending-badge').textContent = reservations.filter(item => item.status === 'pending').length;
  $('#stat-confirmed').textContent = reservations.filter(item => item.status === 'confirmed').length;
  renderCalendar(cars, reservations); renderRequests(cars, reservations); renderFleet(cars);
}

function openReservation(carId, day) {
  const form = $('#reservation-form'); form.reset();
  const options = $('#reservation-car'); options.replaceChildren();
  for (const car of getCars().filter(item => item.active)) {
    const option = el('option', '', car.name); option.value = car.id; options.append(option);
  }
  if (!options.children.length) { toast('Сначала включите автомобиль в разделе «Автомобили».', true); setTab('fleet'); return; }
  if (carId) options.value = carId;
  const range = day === undefined ? defaultPeriod('hours') : { start: new Date(day + 10 * 3600000).toISOString(), end: new Date(day + 14 * 3600000).toISOString() };
  form.elements.start.value = toLocalInput(range.start); form.elements.end.value = toLocalInput(range.end);
  $('#reservation-error').hidden = true; updateDuration(); $('#reservation-dialog').showModal();
}

function updateDuration() {
  const form = $('#reservation-form');
  try { $('#reservation-duration').textContent = `Продолжительность: ${durationLabel(parseLocalDateTime(form.elements.start.value), parseLocalDateTime(form.elements.end.value))}`; }
  catch { $('#reservation-duration').textContent = 'Укажите начало и окончание аренды.'; }
}

function openCar(car) {
  const form = $('#car-form');
  form.elements.id.value = car.id; form.elements.name.value = car.name; form.elements.description.value = car.description;
  form.elements.category.value = car.category; form.elements.active.checked = car.active;
  $('#car-error').hidden = true; $('#car-dialog').showModal();
}

document.querySelectorAll('[data-tab]').forEach(node => node.addEventListener('click', () => setTab(node.dataset.tab)));
document.querySelectorAll('[data-close-dialog]').forEach(node => node.addEventListener('click', () => document.getElementById(node.dataset.closeDialog).close()));
$('#add-reservation').addEventListener('click', () => openReservation());
$('#previous-week').addEventListener('click', () => { weekOffset--; render(); });
$('#next-week').addEventListener('click', () => { weekOffset++; render(); });
$('#current-week').addEventListener('click', () => { weekOffset = 0; render(); });
$('#request-filter').addEventListener('change', () => renderRequests(getCars(), getReservations()));
$('#reservation-form').addEventListener('input', updateDuration);
$('#reservation-form').elements.status.addEventListener('change', event => {
  const form = $('#reservation-form');
  if (event.target.value === 'blocked') { form.elements.customerName.value = 'Тестовая блокировка'; form.elements.eventType.value = 'Обслуживание'; }
  else if (form.elements.customerName.value === 'Тестовая блокировка') { form.elements.customerName.value = 'Тестовый клиент'; form.elements.eventType.value = 'Свадьба'; }
});
$('#reservation-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  try {
    createReservation({ carId: form.elements.carId.value, start: parseLocalDateTime(form.elements.start.value), end: parseLocalDateTime(form.elements.end.value), status: form.elements.status.value, eventType: form.elements.eventType.value, customerName: form.elements.customerName.value, notes: form.elements.notes.value });
    $('#reservation-dialog').close(); toast('Тестовая запись добавлена. Данные сохранены в этом браузере.');
  } catch (error) { $('#reservation-error').textContent = error.message; $('#reservation-error').hidden = false; }
});
$('#car-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  try {
    updateCar(form.elements.id.value, { name: form.elements.name.value, description: form.elements.description.value, category: form.elements.category.value, active: form.elements.active.checked });
    $('#car-dialog').close(); toast('Демонстрационный автомобиль обновлён.');
  } catch (error) { $('#car-error').textContent = error.message; $('#car-error').hidden = false; }
});
$('#reset-demo').addEventListener('click', () => {
  if (confirm('Восстановить демоверсию? Созданные в этом браузере тестовые заявки и изменения автомобилей будут заменены начальными примерами.')) run(() => { resetDemo(); weekOffset = 0; render(); }, 'Демоданные восстановлены.');
});
subscribe(render);
render();
