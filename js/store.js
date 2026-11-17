/** Browser-local demonstration data. Never a shared booking service. */
export const DEMO_TIMEZONE = 'Europe/Moscow';
export const STORAGE_KEY = 'nurislam-rental-demo-v1';
export const DEFAULT_CAR_IMAGE = 'assets/images/car-placeholder.svg';
export const MAX_CAR_IMAGE_LENGTH = 650 * 1024;
export const BLOCKING_STATUSES = ['confirmed', 'completed', 'blocked'];
export const STATUS_LABELS = { pending: 'Новая заявка', confirmed: 'Подтверждена', completed: 'Завершена', cancelled: 'Отменена', blocked: 'Недоступен' };
const STATUSES = Object.keys(STATUS_LABELS);
const OFFSET = 3 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (message, code = 'VALIDATION') => Object.assign(new Error(message), { code });
const STATIC_CAR_IMAGES = new Set([
  DEFAULT_CAR_IMAGE,
  ...['rolls-royce', 'maybach', 'maybach-480', 'maybach-800', 'business', 'business-480', 'business-800', 'hero', 'hero-720', 'hero-1280', 'hero-1920'].map(name => `assets/images/${name}.webp`),
]);

/** Only packaged images or bounded raster uploads; never remote URLs or uploaded SVG. */
export function isSafeCarImage(image) {
  if (typeof image !== 'string' || image.length > MAX_CAR_IMAGE_LENGTH) return false;
  if (STATIC_CAR_IMAGES.has(image)) return true;
  const prefix = /^data:image\/(jpeg|png|webp);base64,/.exec(image);
  if (!prefix) return false;
  const encoded = image.slice(prefix[0].length);
  if (!encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  try {
    const header = atob(encoded.slice(0, 24));
    if (prefix[1] === 'jpeg') return header.startsWith('\xff\xd8\xff');
    if (prefix[1] === 'png') return header.startsWith('\x89PNG\r\n\x1a\n');
    return header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  } catch { return false; }
}

function cleanCarImage(image = DEFAULT_CAR_IMAGE) {
  if (typeof image === 'string' && image.length > MAX_CAR_IMAGE_LENGTH) throw fail('Изображение слишком большое. Выберите фото меньшего размера (до 650 КБ после обработки).');
  if (!isSafeCarImage(image)) throw fail('Выберите корректное изображение JPEG, PNG или WebP.');
  return image;
}

const iso = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))) throw fail('Укажите дату и время с часовым поясом.');
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw fail('Укажите корректные дату и время.');
  return new Date(time).toISOString();
};

export function toLocalInput(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return new Date(time + OFFSET).toISOString().slice(0, 16);
}

export function parseLocalDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw fail('Выберите дату и время начала и окончания.');
  const parsed = iso(`${value}:00+03:00`);
  if (toLocalInput(parsed) !== value) throw fail('Такой даты или времени не существует.');
  return parsed;
}

export function validatePeriod(start, end, { future = false, now = Date.now() } = {}) {
  const from = iso(start), until = iso(end);
  const startAt = Date.parse(from), endAt = Date.parse(until);
  if (endAt <= startAt) throw fail('Окончание аренды должно быть позже начала.');
  if (future && startAt < now) throw fail('Выберите начало аренды в будущем.');
  if (endAt - startAt > 90 * DAY) throw fail('В демоверсии можно выбрать период до 90 дней.');
  return { start: from, end: until, startAt, endAt };
}

export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

export function defaultPeriod(mode = 'hours', now = Date.now()) {
  const tomorrow = new Date(now + OFFSET + DAY).toISOString().slice(0, 10);
  const start = parseLocalDateTime(`${tomorrow}T10:00`);
  const duration = mode === 'day' ? DAY : mode === 'days' || mode === 'multiday' ? 3 * DAY : 4 * 60 * 60 * 1000;
  return { start, end: new Date(Date.parse(start) + duration).toISOString() };
}

export function formatDateTime(value, options = {}) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: DEMO_TIMEZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...options }).format(parsed);
}

export function durationLabel(start, end) {
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Выберите период';
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  return [days && `${days} сут.`, hours && `${hours} ч`, rest && `${rest} мин`].filter(Boolean).join(' ');
}

function seedState(now) {
  const tomorrow = new Date(now + OFFSET + DAY).toISOString().slice(0, 10);
  const after = new Date(now + OFFSET + 2 * DAY).toISOString().slice(0, 10);
  const makeExample = (id, carId, date, from, to, status) => ({
    id, carId, ...validatePeriod(parseLocalDateTime(`${date}T${from}`), parseLocalDateTime(`${date}T${to}`)), status,
    customerName: 'Пример занятости', eventType: status === 'blocked' ? 'Обслуживание' : 'Свадьба',
    notes: 'Демонстрационная запись. Не отражает реальную занятость.', isExample: true, createdAt: now, updatedAt: now,
  });
  return {
    version: 1,
    cars: [
      { id: 'rolls-royce', name: 'Rolls-Royce', category: 'wedding', description: 'Выразительный акцент для особенного события.', image: 'assets/images/rolls-royce.webp', color: 'Белый', seats: null, active: true, isDemo: true },
      { id: 'maybach', name: 'Mercedes-Maybach', category: 'meeting', description: 'Сдержанный характер и внимание к деталям.', image: 'assets/images/maybach.webp', color: 'Серебристый', seats: null, active: true, isDemo: true },
      { id: 'business', name: 'Бизнес-класс', category: 'meeting', description: 'Для деловых встреч и важных поездок.', image: 'assets/images/business.webp', color: 'Чёрный', seats: null, active: true, isDemo: true },
    ],
    reservations: [makeExample('example-rr', 'rolls-royce', tomorrow, '12:00', '18:00', 'confirmed'), makeExample('example-maybach', 'maybach', after, '10:00', '18:00', 'blocked')],
  };
}

function validateState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.cars) || !Array.isArray(value.reservations)) throw fail('Сохранённые демоданные повреждены. Восстановите демоверсию в CRM.', 'STORAGE_CORRUPT');
  const ids = new Set();
  for (const car of value.cars) {
    if (!car || typeof car.id !== 'string' || typeof car.name !== 'string' || typeof car.active !== 'boolean' || ids.has(car.id)) throw fail('Данные автопарка повреждены. Восстановите демоверсию в CRM.', 'STORAGE_CORRUPT');
    // Older records without a picture remain usable; unsafe persisted sources never render.
    if (car.image === undefined) car.image = DEFAULT_CAR_IMAGE;
    if (!isSafeCarImage(car.image)) throw fail('Сохранённое изображение автомобиля повреждено. Восстановите демоверсию в CRM.', 'STORAGE_CORRUPT');
    ids.add(car.id);
  }
  const reservationIds = new Set();
  for (const booking of value.reservations) {
    if (typeof booking.id !== 'string' || reservationIds.has(booking.id) || !ids.has(booking.carId) || !STATUSES.includes(booking.status)) throw fail('Данные календаря повреждены. Восстановите демоверсию в CRM.', 'STORAGE_CORRUPT');
    Object.assign(booking, validatePeriod(booking.start, booking.end));
    reservationIds.add(booking.id);
  }
  return value;
}

/** Dependency-injected storage makes interval and persistence behaviour testable. */
export function createDemoStore({ storage = null, now = () => Date.now(), idFactory = () => globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}` } = {}) {
  let state = seedState(now()), storageError = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => { try { listener(); } catch (error) { console.error('Ошибка обновления интерфейса', error); } });
  const read = () => {
    if (!storage) { storageError = 'Хранилище браузера недоступно. Изменения не будут сохранены.'; return; }
    try {
      const raw = storage.getItem(STORAGE_KEY);
      state = raw === null ? seedState(now()) : validateState(JSON.parse(raw));
      storageError = null;
    } catch (error) {
      storageError = error.code === 'STORAGE_CORRUPT' ? error.message : 'Не удалось прочитать демоданные. Проверьте доступ к хранилищу браузера или восстановите демоверсию.';
    }
  };
  const persist = next => {
    if (!storage) throw fail('Хранилище браузера недоступно. Разрешите сохранение данных для этого сайта.', 'STORAGE_UNAVAILABLE');
    try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { throw fail('Не удалось сохранить изменение: хранилище браузера недоступно или заполнено.', 'STORAGE_WRITE'); }
    state = next;
    storageError = null;
    notify();
  };
  read();
  if (storage && !storageError) {
    try { if (storage.getItem(STORAGE_KEY) === null) persist(state); } catch (error) { storageError = error.message; }
  }
  const fresh = () => { read(); if (storageError) throw fail(storageError, 'STORAGE_READ'); return clone(state); };
  const getCar = (next, id) => { const car = next.cars.find(item => item.id === id); if (!car) throw fail('Автомобиль не найден.'); return car; };
  const conflictsFor = (next, carId, range, excludeId) => next.reservations.filter(item => item.id !== excludeId && item.carId === carId && BLOCKING_STATUSES.includes(item.status) && overlaps(range.startAt, range.endAt, item.startAt, item.endAt));
  const assertAvailable = (next, carId, range, excludeId, allowInactive = false) => {
    const car = getCar(next, carId);
    if (!car.active && !allowInactive) throw fail('Автомобиль временно скрыт из каталога.', 'INACTIVE');
    if (conflictsFor(next, carId, range, excludeId).length) throw fail('На этот период автомобиль уже занят. Выберите другое время или автомобиль.', 'CONFLICT');
  };
  const cleanText = (value, max, fallback = '') => {
    if (value !== undefined && typeof value !== 'string') throw fail('Проверьте текстовые поля формы.');
    const text = (value || fallback).trim();
    if (text.length > max) throw fail(`Слишком длинный текст: максимум ${max} символов.`);
    return text;
  };
  const makeReservation = (payload, forcedStatus) => {
    const next = fresh();
    const status = forcedStatus || payload.status || 'confirmed';
    if (!['pending', 'confirmed', 'blocked'].includes(status)) throw fail('Недопустимый статус новой записи.');
    const range = validatePeriod(payload.start, payload.end, { future: status === 'pending', now: now() });
    assertAvailable(next, payload.carId, range);
    const reservation = {
      id: idFactory(), carId: payload.carId, ...range, status,
      customerName: cleanText(payload.customerName, 80, status === 'blocked' ? 'Тестовая блокировка' : 'Тестовый клиент'),
      eventType: cleanText(payload.eventType, 60, status === 'blocked' ? 'Обслуживание' : 'Другое событие'),
      notes: cleanText(payload.notes, 500), isExample: false, createdAt: now(), updatedAt: now(),
    };
    next.reservations.push(reservation);
    persist(next);
    return clone(reservation);
  };
  return {
    getCars() { read(); return clone(state.cars); },
    getReservations() { read(); return clone(state.reservations); },
    getStorageStatus() { return { available: !storageError, message: storageError }; },
    availability(carId, start, end) {
      read();
      if (storageError) throw fail(storageError, 'STORAGE_READ');
      const range = validatePeriod(start, end);
      const car = getCar(state, carId);
      const conflicts = conflictsFor(state, carId, range);
      return { available: car.active && !conflicts.length, conflicts: clone(conflicts), inactive: !car.active };
    },
    createRequest(payload) { return makeReservation(payload, 'pending'); },
    createReservation(payload) { return makeReservation(payload); },
    createCar(payload = {}) {
      const next = fresh();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('Проверьте данные автомобиля.');
      const name = cleanText(payload.name, 80);
      if (!name) throw fail('Укажите название автомобиля.');
      const description = cleanText(payload.description, 220);
      const category = payload.category === undefined ? 'meeting' : payload.category;
      if (!['wedding', 'meeting'].includes(category)) throw fail('Выберите категорию автомобиля.');
      const active = payload.active === undefined ? true : payload.active;
      if (typeof active !== 'boolean') throw fail('Некорректное состояние автомобиля.');
      const image = cleanCarImage(payload.image);
      const baseId = `car-${idFactory()}`;
      let id = baseId, suffix = 2;
      while (next.cars.some(car => car.id === id)) id = `${baseId}-${suffix++}`;
      const car = { id, name, description, category, image, color: '', seats: null, active, isDemo: true, createdAt: now(), updatedAt: now() };
      next.cars.push(car);
      persist(next);
      return clone(car);
    },
    updateReservation(id, patch) {
      const next = fresh();
      const record = next.reservations.find(item => item.id === id);
      if (!record) throw fail('Запись не найдена.');
      const status = patch.status || record.status;
      const transitions = { pending: ['pending', 'confirmed', 'cancelled'], confirmed: ['confirmed', 'completed', 'cancelled'], blocked: ['blocked', 'cancelled'], completed: ['completed'], cancelled: ['cancelled'] };
      if (!transitions[record.status].includes(status)) throw fail('Этот переход статуса недоступен. Создайте новую запись.');
      const range = validatePeriod(patch.start || record.start, patch.end || record.end);
      const carId = patch.carId || record.carId;
      getCar(next, carId);
      // Hiding a car must not prevent finishing or annotating its existing rental.
      // Assigning a new slot or confirming a pending request still requires an active car.
      const keepsExistingSlot = BLOCKING_STATUSES.includes(record.status) && carId === record.carId && range.startAt === record.startAt && range.endAt === record.endAt;
      if (BLOCKING_STATUSES.includes(status)) assertAvailable(next, carId, range, id, keepsExistingSlot);
      Object.assign(record, range, { carId, status, updatedAt: now() });
      for (const [key, max] of [['customerName', 80], ['eventType', 60], ['notes', 500]]) if (patch[key] !== undefined) record[key] = cleanText(patch[key], max);
      persist(next);
      return clone(record);
    },
    updateCar(id, patch) {
      const next = fresh(); const car = getCar(next, id);
      if (patch.name !== undefined) { const name = cleanText(patch.name, 80); if (!name) throw fail('Укажите название автомобиля.'); car.name = name; }
      if (patch.description !== undefined) car.description = cleanText(patch.description, 220);
      if (patch.active !== undefined) { if (typeof patch.active !== 'boolean') throw fail('Некорректное состояние автомобиля.'); car.active = patch.active; }
      if (patch.category !== undefined) { if (!['wedding', 'meeting'].includes(patch.category)) throw fail('Выберите категорию автомобиля.'); car.category = patch.category; }
      if (patch.image !== undefined) car.image = cleanCarImage(patch.image);
      car.updatedAt = now();
      persist(next); return clone(car);
    },
    resetDemo() { persist(seedState(now())); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    handleStorageEvent(event) { if (!event || event.key === STORAGE_KEY || event.key === null) { read(); notify(); } },
  };
}

let browserStorage = null;
try { if (typeof window !== 'undefined') browserStorage = window.localStorage || null; } catch { /* Reads remain viewable, writes fail explicitly. */ }
const store = createDemoStore({ storage: browserStorage });
if (typeof window !== 'undefined') window.addEventListener('storage', event => store.handleStorageEvent(event));
export const getCars = () => store.getCars();
export const getReservations = () => store.getReservations();
export const getStorageStatus = () => store.getStorageStatus();
export const availability = (...args) => store.availability(...args);
export const createRequest = payload => store.createRequest(payload);
export const createReservation = payload => store.createReservation(payload);
export const createCar = payload => store.createCar(payload);
export const updateReservation = (...args) => store.updateReservation(...args);
export const updateCar = (...args) => store.updateCar(...args);
export const resetDemo = () => store.resetDemo();
export const subscribe = listener => store.subscribe(listener);
