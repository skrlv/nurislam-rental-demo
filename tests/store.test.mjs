import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoStore, parseLocalDateTime, toLocalInput, defaultPeriod, overlaps, durationLabel, STORAGE_KEY } from '../js/store.js';

const NOW = Date.parse('2026-11-17T08:00:00+03:00');
const iso = local => parseLocalDateTime(local);
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const setup = () => { let next = 0; return createDemoStore({ storage: storage(), now: () => NOW, idFactory: () => `test-${++next}` }); };
const request = (start = '2026-11-20T10:00', end = '2026-11-20T14:00') => ({ carId: 'business', start: iso(start), end: iso(end), eventType: 'Деловая встреча', customerName: 'Тестовый клиент' });

test('Moscow input converts deterministically and rejects invalid calendar dates', () => {
  assert.equal(iso('2026-11-17T10:30'), '2026-11-17T07:30:00.000Z');
  assert.equal(toLocalInput('2026-11-17T07:30:00.000Z'), '2026-11-17T10:30');
  assert.throws(() => iso('2026-02-30T10:30'), /не существует/);
  assert.throws(() => iso('2026-11-17T25:00'), /корректные/);
  assert.throws(() => iso('2026-11-17'), /Выберите/);
});

test('default period supports hours, one day and multiple days across boundaries', () => {
  const hours = defaultPeriod('hours', NOW), day = defaultPeriod('day', NOW), days = defaultPeriod('days', NOW);
  assert.equal(hours.start, '2026-11-18T07:00:00.000Z');
  assert.equal(durationLabel(hours.start, hours.end), '4 ч');
  assert.equal(durationLabel(day.start, day.end), '1 сут.');
  assert.equal(durationLabel(days.start, days.end), '3 сут.');
});

test('half-open overlap accepts adjacent intervals, rejects every real intersection', () => {
  assert.equal(overlaps(10, 20, 20, 30), false);
  assert.equal(overlaps(10, 20, 0, 10), false);
  assert.equal(overlaps(10, 20, 15, 25), true);
  assert.equal(overlaps(10, 20, 11, 12), true);
  assert.equal(overlaps(10, 20, 1, 30), true);
});

test('pending requests do not reserve time; competing confirmations cannot overlap', () => {
  const store = setup();
  const first = store.createRequest(request());
  const second = store.createRequest(request());
  assert.equal(first.status, 'pending');
  assert.equal(store.availability('business', first.start, first.end).available, true);
  store.updateReservation(first.id, { status: 'confirmed' });
  assert.equal(store.availability('business', first.start, first.end).available, false);
  assert.throws(() => store.updateReservation(second.id, { status: 'confirmed' }), error => error.code === 'CONFLICT');
  assert.equal(store.getReservations().find(item => item.id === second.id).status, 'pending');
});

test('cancellation releases time and adjacent bookings remain allowed', () => {
  const store = setup();
  const first = store.createReservation(request());
  const adjacent = store.createReservation(request('2026-11-20T14:00', '2026-11-20T16:00'));
  assert.ok(adjacent.id);
  store.updateReservation(first.id, { status: 'cancelled' });
  assert.equal(store.availability('business', first.start, first.end).available, true);
  assert.throws(() => store.updateReservation(first.id, { status: 'confirmed' }), /переход/);
});

test('blocks, overnight periods and completed history prevent overlaps', () => {
  const store = setup();
  const block = store.createReservation({ ...request('2026-11-20T22:00', '2026-11-22T08:00'), status: 'blocked' });
  assert.throws(() => store.createRequest(request('2026-11-21T00:00', '2026-11-21T01:00')), /занят/);
  store.updateReservation(block.id, { status: 'cancelled' });
  const rent = store.createReservation(request());
  store.updateReservation(rent.id, { status: 'completed' });
  assert.equal(store.availability('business', rent.start, rent.end).available, false);
});

test('moving a confirmed booking validates overlaps and does not partially save', () => {
  const store = setup();
  const first = store.createReservation(request());
  const later = store.createReservation(request('2026-11-21T10:00', '2026-11-21T14:00'));
  assert.throws(() => store.updateReservation(later.id, { start: first.start, end: first.end }), /занят/);
  assert.equal(store.getReservations().find(item => item.id === later.id).start, later.start);
});

test('bad range, past request and inactive car are rejected without new records', () => {
  const store = setup(), initial = store.getReservations().length;
  assert.throws(() => store.createRequest(request('2026-11-20T10:00', '2026-11-20T10:00')), /позже/);
  assert.throws(() => store.createRequest(request('2026-11-16T10:00', '2026-11-16T14:00')), /будущем/);
  store.updateCar('business', { active: false });
  assert.equal(store.availability('business', request().start, request().end).available, false);
  assert.throws(() => store.createRequest(request()), /скрыт/);
  assert.equal(store.getReservations().length, initial);
});

test('hiding a car allows completing its existing rental but prevents confirming or moving slots', () => {
  const store = setup();
  const existing = store.createReservation(request());
  const pending = store.createRequest(request('2026-11-21T10:00', '2026-11-21T14:00'));
  store.updateCar('business', { active: false });
  assert.throws(() => store.updateReservation(pending.id, { status: 'confirmed' }), error => error.code === 'INACTIVE');
  assert.throws(() => store.updateReservation(existing.id, { start: pending.start, end: pending.end }), error => error.code === 'INACTIVE');
  assert.equal(store.updateReservation(existing.id, { status: 'completed' }).status, 'completed');
});

test('latest persisted state is read before mutation across store instances', () => {
  const shared = storage();
  const first = createDemoStore({ storage: shared, now: () => NOW, idFactory: () => 'a' });
  const second = createDemoStore({ storage: shared, now: () => NOW, idFactory: () => 'b' });
  first.createReservation(request());
  assert.throws(() => second.createReservation(request()), /занят/);
  assert.equal(second.getReservations().length, 3);
});

test('storage removal in another tab clears stale requests before subsequent writes', () => {
  const shared = storage();
  const store = createDemoStore({ storage: shared, now: () => NOW });
  const previous = store.createRequest(request());
  let updates = 0; store.subscribe(() => updates++);
  shared.removeItem(STORAGE_KEY);
  store.handleStorageEvent({ key: STORAGE_KEY });
  assert.equal(updates, 1);
  assert.equal(store.getReservations().some(item => item.id === previous.id), false);
  store.updateCar('business', { name: 'Тестовый автомобиль' });
  assert.equal(JSON.parse(shared.getItem(STORAGE_KEY)).reservations.length, 2);
});

test('storage failures surface and failed writes never alter durable state', () => {
  const values = storage(); let deny = false;
  const wrapped = { getItem: values.getItem, setItem: (...args) => { if (deny) throw new Error('quota'); values.setItem(...args); } };
  const store = createDemoStore({ storage: wrapped, now: () => NOW });
  const old = values.getItem(STORAGE_KEY); deny = true;
  assert.throws(() => store.createRequest(request()), /Не удалось сохранить/);
  assert.equal(values.getItem(STORAGE_KEY), old);
  assert.equal(store.getReservations().length, 2);
});

test('corrupt data is preserved until explicit reset, then listeners are notified', () => {
  const values = storage(); values.setItem(STORAGE_KEY, '{broken');
  const store = createDemoStore({ storage: values, now: () => NOW });
  assert.equal(store.getStorageStatus().available, false);
  assert.throws(() => store.createRequest(request()), /прочитать/);
  assert.equal(values.getItem(STORAGE_KEY), '{broken');
  let updated = 0; const unsubscribe = store.subscribe(() => updated++);
  store.resetDemo();
  assert.equal(store.getStorageStatus().available, true);
  assert.equal(updated, 1);
  unsubscribe(); store.handleStorageEvent({ key: STORAGE_KEY }); assert.equal(updated, 1);
});

test('callers cannot mutate store state through returned records', () => {
  const store = setup(); const cars = store.getCars(); cars[0].name = 'modified';
  assert.equal(store.getCars()[0].name, 'Rolls-Royce');
});
