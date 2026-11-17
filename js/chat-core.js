/** Small, deterministic rental knowledge assistant. No network or language model. */
const HOUR = 3600000;
const DAY = 24 * HOUR;
const OFFSET = 3 * HOUR;
const MAX_DAYS = 90;
const NUMBER_WORDS = { один: 1, одну: 1, одни: 1, одних: 1, два: 2, две: 2, двое: 2, двух: 2, три: 3, трое: 3, трех: 3, четыре: 4, четверо: 4, пяти: 5, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10 };
const MONTHS = { январь: 1, января: 1, февраль: 2, февраля: 2, март: 3, марта: 3, апрель: 4, апреля: 4, май: 5, мая: 5, июнь: 6, июня: 6, июль: 7, июля: 7, август: 8, августа: 8, сентябрь: 9, сентября: 9, октябрь: 10, октября: 10, ноябрь: 11, ноября: 11, декабрь: 12, декабря: 12 };
const SUGGESTIONS = ['На 3 часа завтра', 'На двое суток', 'Какие машины?'];

export function normalizeText(value) {
  return String(value ?? '').slice(0, 1000).toLowerCase().normalize('NFC').replace(/\u0301/g, '').replace(/ё/g, 'е').replace(/[«»“”]/g, '"').replace(/\s+/g, ' ').trim();
}

function localParts(timestamp) {
  const date = new Date(timestamp + OFFSET);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

function timestampFor(parts) {
  const result = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 10, parts.minute ?? 0) - OFFSET;
  const actual = localParts(result);
  if (['year', 'month', 'day', 'hour', 'minute'].some(key => actual[key] !== (parts[key] ?? (key === 'hour' ? 10 : 0)))) return NaN;
  return result;
}

const parseNumber = word => NUMBER_WORDS[word] || Number(word);

function durationFrom(text) {
  if (/полчаса/.test(text)) return HOUR / 2;
  if (/полтора\s*час/.test(text)) return 1.5 * HOUR;
  const match = text.match(/(?:на\s+)?(\d+(?:[.,]\d+)?|один|одну|одни|одних|два|две|двое|двух|три|трое|трех|четыре|четверо|пять|пяти|шесть|семь|восемь|девять|десять)\s*(час(?:а|ов)?|ч\.?|сут(?:ки|ок)?|день|дня|дней|недел(?:ю|и|ь)|минут(?:у|ы)?|мин)\s*(?:$|[.,!?]|\s)/);
  if (match) {
    const amount = parseNumber(match[1].replace(',', '.'));
    const unit = match[2];
    return amount * (/^(час|ч)/.test(unit) ? HOUR : /^(мин)/.test(unit) ? 60000 : /^недел/.test(unit) ? 7 * DAY : DAY);
  }
  if (/(?:на\s+)?сутки|на\s+день/.test(text)) return DAY;
  if (/на\s+неделю/.test(text)) return 7 * DAY;
  if (/на\s+час(?:\s|$|[.!?])/.test(text)) return HOUR;
  return null;
}

function datesFrom(text, now) {
  const current = localParts(now);
  const found = [];
  const add = (match, year, month, day) => found.push({ year, month, day, index: match.index });
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) add(m, Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/g)) {
    if (/^\s*(час|сут|дня|дней|недел|мин)/.test(text.slice(m.index + m[0].length))) continue;
    add(m, m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : current.year, Number(m[2]), Number(m[1]));
  }
  const monthPattern = new RegExp('(?<!\\d)(\\d{1,2})\\s+(' + Object.keys(MONTHS).join('|') + ')(?:\\s+(\\d{4}))?', 'g');
  for (const m of text.matchAll(monthPattern)) add(m, Number(m[3] || current.year), MONTHS[m[2]], Number(m[1]));
  if (found.length) return found.sort((a, b) => a.index - b.index);
  const relative = text.includes('послезавтра') ? 2 : text.includes('завтра') ? 1 : text.includes('сегодня') ? 0 : null;
  if (relative !== null) return [{ ...localParts(now + relative * DAY), index: 0 }];
  return [];
}

function timesFrom(text) {
  const found = [];
  for (const m of text.matchAll(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g)) found.push({ hour: Number(m[1]), minute: Number(m[2]), index: m.index });
  if (!found.length) for (const m of text.matchAll(/(?:^|\s)(?:с|в|до)\s+(\d{1,2})(?=\s|$|[!?])/g)) found.push({ hour: Number(m[1]), minute: 0, index: m.index });
  return found;
}

function selectedRange(context, now) {
  const start = Date.parse(context.start), end = Date.parse(context.end);
  return Number.isFinite(start) && Number.isFinite(end) && start >= now && end > start && end - start <= MAX_DAYS * DAY ? { start, end } : null;
}

/** Returns an explicit proposal, never reserves or mutates any state. All times use UTC+03. */
export function parsePeriodIntent(message, context = {}, now = Date.now()) {
  const text = normalizeText(message);
  const dates = datesFrom(text, now), times = timesFrom(text), duration = durationFrom(text);
  const hasIntent = dates.length > 0 || times.length > 0 || duration !== null || /несколько\s+дней|на\s+часы|многоднев|почасов/.test(text);
  if (!hasIntent) return null;
  if (/несколько\s+дней/.test(text) && !dates.length && duration === null) return { incomplete: true, message: 'На несколько дней можно. Укажите начало и окончание, например: «с 20.12.2026 10:00 до 23.12.2026 10:00».', mode: 'days' };
  if (times.some(time => time.hour > 23 || time.minute > 59)) return { error: 'Проверьте время: часы от 00 до 23, минуты от 00 до 59.' };
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) return { error: 'Срок аренды должен быть больше нуля.' };
  if (dates.some(date => !Number.isFinite(timestampFor({ ...date, hour: 10, minute: 0 })))) return { error: 'Такой даты не существует. Напишите дату в формате ДД.ММ.ГГГГ.' };
  const selected = selectedRange(context, now);
  if (duration === null && dates.length < 2 && times.length < 2 && !selected) return { incomplete: true, message: 'На какой срок нужна машина? Например: «завтра с 15:00 на 3 часа» или «на двое суток».', mode: 'hours' };
  const startParts = dates[0] || (selected ? localParts(selected.start) : localParts(now + DAY));
  const startTime = times[0] || (selected && !dates.length ? localParts(selected.start) : { hour: 10, minute: 0 });
  const startAt = timestampFor({ ...startParts, hour: startTime.hour, minute: startTime.minute });
  let endAt;
  if (dates.length >= 2) {
    const endTime = times[1] || startTime;
    endAt = timestampFor({ ...dates[1], hour: endTime.hour, minute: endTime.minute });
  } else if (times.length >= 2) {
    endAt = timestampFor({ ...startParts, ...times[1] });
    if (endAt <= startAt) endAt += DAY;
  } else {
    endAt = startAt + (duration ?? (selected.end - selected.start));
  }
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return { error: 'Не удалось распознать дату. Напишите, например: «20.12.2026 с 15:00 на 3 часа».' };
  if (startAt < now) return { error: 'Это время уже прошло. Выберите будущие дату и время; в календаре используется МСК (UTC+3).' };
  if (endAt <= startAt) return { error: 'Окончание должно быть позже начала аренды.' };
  if (endAt - startAt > MAX_DAYS * DAY) return { error: 'В демоверсии можно выбрать период до 90 дней.' };
  const mode = endAt - startAt < DAY ? 'hours' : endAt - startAt === DAY ? 'day' : 'days';
  const eventType = /свад|жених|невест/.test(text) ? 'wedding' : /встреч|делов|бизнес/.test(text) ? 'meeting' : context.eventType || '';
  return { mode, start: new Date(startAt).toISOString(), end: new Date(endAt).toISOString(), eventType, assumedStart: !dates.length && !selected, assumedTime: !times.length && (!selected || dates.length > 0) };
}

export function formatPeriod(period) {
  const fmt = value => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  return `${fmt(period.start)} — ${fmt(period.end)} (МСК)`;
}

function matchedCar(text, cars, context) {
  const words = value => normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const query = ` ${words(text)} `;
  const named = cars.map(car => ({ car, name: words(car.name) }))
    .filter(item => item.name && query.includes(` ${item.name} `))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (named) return named.car;
  const alias = [/ролл|ролс|rolls|ройс|роис/, /майбах|маибах|майбак|maybach|маебах/, /бизнес.?класс|business/].find(pattern => pattern.test(text));
  return alias ? cars.find(car => alias.test(normalizeText(car.name))) : cars.find(car => car.id === context.carId);
}

function availabilityText(cars, start, end, getAvailability) {
  if (typeof getAvailability !== 'function') return 'Проверку доступности можно посмотреть в форме подбора.';
  try {
    const checked = cars.filter(car => car.active !== false).map(car => ({ ...car, available: getAvailability(car.id, start, end).available }));
    if (!checked.length) return 'В демонстрационном каталоге пока нет активных автомобилей.';
    return checked.map(car => `${car.name}: ${car.available ? 'свободен' : 'занят'} в демокалендаре`).join('\n') + '.\nЭто тестовые данные этого браузера, не реальная занятость автопарка.';
  } catch {
    return 'Не удалось прочитать демокалендарь. Доступность сейчас не подтверждаю; проверьте форму подбора или восстановите демоданные в CRM.';
  }
}

/** @returns {{text:string,actions:Array,suggestions:Array<string>,period?:object}} */
export function answerQuestion(message, context = {}, options = {}) {
  const text = normalizeText(message), now = options.now ?? Date.now();
  const cars = (options.cars || []).filter(car => car.active !== false);
  const respond = (reply, actions = [], suggestions = SUGGESTIONS) => ({ text: reply, actions, suggestions });
  if (!text) return respond('Задайте вопрос об аренде или выберите подсказку.');
  if (String(message).length > 600) return respond('Пожалуйста, сократите вопрос до 600 символов.');
  if (/цен[ауы]|стоим|стоем|скол[ьъ]?ко\s+(стоит|стоет|денег)|прайс|тариф|бесплат|скидк|дешев/.test(text)) return respond('Цены и тарифы пока не подтверждены владельцем. Не буду придумывать сумму. Можно выбрать машину и период, чтобы подготовить запрос; на этом демосайте оплата не принимается.', [], ['На 3 часа завтра', 'Какие машины?', 'Как оформить заявку?']);
  if (/залог|депозит|предоплат|оплат|карт[аоуы]\b|возврат\s+ден/.test(text)) return respond('Размер залога, предоплата и способы оплаты ещё не подтверждены. Их нужно согласовать с владельцем до аренды. Демоверсия не принимает платежи и не просит реквизиты карты.');
  if (/водител|шофер|сам\s+за\s+рул|без\s+водит/.test(text)) return respond('Формат аренды с водителем или без него пока не подтверждён. Уточните его у владельца до оформления; я не буду обещать неподтверждённую услугу.');
  if (/город|адрес|маха[чш]кал|дагестан|где\s+(вы|забрать|находит)|географ|достав|подач|аэропорт|выезд|территор/.test(text)) return respond('Город, территория обслуживания, место выдачи и условия подачи пока уточняются у владельца. На сайте нет подтверждённого адреса или стоимости доставки.');
  if (/страхов|каско|осаго|стаж|возраст|документ|паспорт|прав[ауы]\b|пробег|лимит|отмен|штраф/.test(text)) return respond('Страхование, требования к водителю, документы, пробег и отмена пока не согласованы для сайта. Эти условия нужно получить у владельца до аренды. Паспортные данные сюда вводить не нужно.', [], ['На несколько дней', 'Как оформить заявку?', 'Какие машины?']);
  const period = parsePeriodIntent(text, context, now);
  if (period?.error || period?.incomplete) return respond(period.error || period.message, [], ['На 3 часа завтра', 'На двое суток', 'На неделю']);
  if (period) {
    const selectedCar = matchedCar(text, cars, context);
    let reply = `Предлагаю период: ${formatPeriod(period)}.`;
    if (period.assumedStart) reply += '\nНачало предложено на завтра, 10:00 — его можно изменить в форме.';
    else if (period.assumedTime) reply += '\nВремя не указано: предложил 10:00, можно изменить.';
    reply += '\n\n' + availabilityText(selectedCar ? [selectedCar] : cars, period.start, period.end, options.availability);
    reply += '\n\nНажмите «Применить даты», чтобы перенести период в форму. Бронь автоматически не создаётся.';
    const actions = [{ type: 'period', label: 'Применить даты', period: { mode: period.mode, start: period.start, end: period.end, eventType: period.eventType } }];
    if (selectedCar) actions.push({ type: 'car', label: `Выбрать ${selectedCar.name}`, carId: selectedCar.id });
    return { ...respond(reply, actions, ['Как оформить заявку?', 'Условия аренды']), period };
  }
  if (/свобод|доступ|занят|календар/.test(text)) {
    const range = selectedRange(context, now), car = matchedCar(text, cars, context);
    if (!range) return respond('Для проверки нужны точные начало и окончание. Напишите, например: «завтра с 15:00 на 3 часа». Проверка использует демонстрационный календарь этого браузера.');
    return respond(`Проверяю выбранный период: ${formatPeriod(context)}.\n\n` + availabilityText(car ? [car] : cars, context.start, context.end, options.availability));
  }
  const car = matchedCar(text, cars, {});
  if (car || /машин|авто|автопарк|ролл|ролс|rolls|роис|ройс|майбах|маибах|maybach|мерседес|mercedes|бизнес.?класс|какие\s+модел/.test(text)) {
    const choices = car ? [car] : cars;
    return respond(choices.length ? `В демонстрационном каталоге: ${choices.map(item => item.name).join(', ')}.\n\nИзображения и состав каталога — примеры. Реальный автопарк нужно подтвердить у владельца. Выберите автомобиль, затем проверьте даты.` : 'В демонстрационном каталоге сейчас нет активных автомобилей.', choices.map(item => ({ type: 'car', label: `Выбрать ${item.name}`, carId: item.id })), ['На 3 часа завтра', 'На двое суток', 'Условия аренды']);
  }
  if (/заяв|брон|брони|заброн|оформ|заказ|арендовать|аренда/.test(text)) return respond('Выберите начало и окончание, событие и автомобиль, затем проверьте доступность. На этом сайте можно создать только тестовую заявку. Она сохраняется в этом браузере, никому не отправляется и не является бронью.\n\nВ CRM новая заявка имеет статус «Новая заявка». В демонстрационном сценарии менеджер должен подтвердить её; до подтверждения машина не зарезервирована.', [], ['На 3 часа завтра', 'На двое суток', 'Какие машины?']);
  if (/услов|как\s+(работ|снять|взять)|можно\s+ли/.test(text)) return respond('Предусмотрена аренда на часы, сутки или несколько дней. Укажите точные начало и окончание.\n\nЦены, залог, документы, формат с водителем и другие условия пока уточняются у владельца. Здесь можно проверить только демонстрационный сценарий без реального заказа.', [], ['На 3 часа завтра', 'На двое суток', 'Как оформить заявку?']);
  if (/свад|жених|невест|кортеж|встреч|меропр|событ/.test(text)) return respond('В профиле сервиса заявлены премиальные автомобили для свадеб, встреч и имиджевых событий. В форме можно выбрать повод, автомобиль и период. Доступность и условия реального заказа нужно подтвердить у владельца.', [], ['На 3 часа завтра', 'Какие машины?', 'Условия аренды']);
  if (/кто\s+ты|на\s+какой\s+модел|языков.{0,12}модел|нейросет|искусствен|\bai\b|\bllm\b|gpt|чат.?бот|помощник/.test(text)) return respond('Я бесплатный помощник по базе сервиса: отвечаю по подготовленным правилам и проверяю демокалендарь. Здесь нет языковой модели, внешнего API и платной подписки. Я не создаю бронь сам и не знаю неподтверждённых условий.', [], ['Какие машины?', 'На 3 часа завтра', 'Условия аренды']);
  if (/^(привет|здравств|добрый|доброе|доброго|hello|hi)/.test(text)) return respond('Здравствуйте! Помогу выбрать срок аренды, посмотреть демонстрационные автомобили и разобраться с заявкой. Можно написать: «завтра с 15:00 на 3 часа».');
  if (/спасибо|благодар/.test(text)) return respond('Пожалуйста! Если нужно, помогу выбрать период и проверить демокалендарь.', [], ['На 3 часа завтра', 'Какие машины?']);
  return respond('По этому вопросу у меня пока нет подтверждённой информации. Могу помочь с периодом аренды, автомобилями и порядком заявки.', [], ['Какие машины?', 'На 3 часа завтра', 'Условия аренды']);
}
