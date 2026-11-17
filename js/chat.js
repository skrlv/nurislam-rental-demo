import { answerQuestion } from './chat-core.js?v=20261117-fleet';
import { getCars, availability } from './store.js?v=20261117-fleet';

/** A local knowledge helper. No visitor messages are sent to a server. */
export function initChat({ getContext = () => ({}), onApplyPeriod, onSelectCar } = {}) {
  if (document.getElementById('rental-chat')) return;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text, handler) => {
    const node = element('button', className, text);
    node.type = 'button';
    if (handler) node.addEventListener('click', handler);
    return node;
  };
  const icon = (name) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('width', '20'); node.setAttribute('height', '20');
    node.setAttribute('fill', 'none'); node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.5'); node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round'); node.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', name === 'close' ? 'M6 6l12 12M6 18L18 6' : name === 'send' ? 'M12 19V5m-6 6 6-6 6 6' : 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 2v-10a9 9 0 1 1 18-.5Z');
    node.append(path);
    return node;
  };

  const root = element('aside', 'rental-chat');
  root.id = 'rental-chat';
  root.setAttribute('aria-label', 'Помощник по аренде');
  const launcher = button('chat-launcher', undefined, () => setOpen(!isOpen));
  launcher.append(icon('chat'), element('span', '', 'Помощник'));
  launcher.setAttribute('aria-controls', 'rental-chat-panel');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-label', 'Открыть помощника по аренде');
  const panel = element('section', 'chat-panel');
  panel.id = 'rental-chat-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'rental-chat-title');
  const header = element('header', 'chat-header');
  const heading = element('div', 'chat-heading');
  const title = element('h2', '', 'Помощник по аренде'); title.id = 'rental-chat-title';
  heading.append(title, element('p', '', 'Ответы по базе сервиса'));
  const close = button('chat-close', undefined, () => setOpen(false));
  close.setAttribute('aria-label', 'Закрыть помощника'); close.append(icon('close'));
  header.append(heading, close);
  const notice = element('p', 'chat-notice', 'Демокалендарь · данные этого браузера');
  const transcript = element('div', 'chat-transcript');
  transcript.setAttribute('role', 'log'); transcript.setAttribute('aria-live', 'polite');
  transcript.setAttribute('aria-relevant', 'additions'); transcript.setAttribute('aria-label', 'Переписка с помощником');
  const chips = element('div', 'chat-suggestions'); chips.setAttribute('aria-label', 'Примеры вопросов');
  const form = element('form', 'chat-compose');
  const label = element('label', 'chat-sr-only', 'Ваш вопрос об аренде'); label.htmlFor = 'rental-chat-input';
  const input = element('input', 'chat-input'); input.id = 'rental-chat-input';
  input.type = 'text'; input.maxLength = 600; input.autocomplete = 'off';
  input.placeholder = 'Например: завтра на 3 часа';
  const send = element('button', 'chat-send'); send.type = 'submit'; send.setAttribute('aria-label', 'Отправить вопрос'); send.append(icon('send'));
  form.append(label, input, send);
  const footnote = element('p', 'chat-footnote', 'Без внешнего AI и передачи сообщений. Не вводите личные данные.');
  panel.append(header, notice, transcript, chips, form, footnote);
  root.append(panel, launcher); document.body.append(root);
  let isOpen = false, conversationDraft = null;

  function context() {
    try { return { ...(getContext() || {}), ...(conversationDraft || {}) }; }
    catch { return conversationDraft || {}; }
  }
  function setOpen(value) {
    isOpen = value; panel.hidden = !value;
    launcher.setAttribute('aria-expanded', String(value));
    launcher.setAttribute('aria-label', value ? 'Скрыть помощника по аренде' : 'Открыть помощника по аренде');
    root.classList.toggle('is-open', value);
    if (value) { input.focus({ preventScroll: true }); scrollTranscript(); }
    else launcher.focus({ preventScroll: true });
  }
  function scrollTranscript() { transcript.scrollTop = transcript.scrollHeight; }
  function addMessage(text, from = 'bot', actions = []) {
    const message = element('div', `chat-message chat-message--${from}`);
    message.append(element('span', 'chat-sr-only', from === 'user' ? 'Вы: ' : 'Помощник: '), element('p', '', text));
    if (actions.length) {
      const area = element('div', 'chat-actions');
      for (const action of actions) {
        const actionButton = button('chat-action', action.label, async () => {
          try {
            if (action.type === 'period') {
              if (typeof onApplyPeriod !== 'function') throw new Error('Выберите эти даты в форме подбора над каталогом.');
              await onApplyPeriod(action.period); conversationDraft = null;
              actionButton.textContent = 'Даты применены'; actionButton.disabled = true;
              addMessage('Перенёс период в форму подбора. Проверьте событие и автомобиль. Это ещё не заявка и не бронь.');
            } else if (action.type === 'car') {
              if (typeof onSelectCar !== 'function') throw new Error('Выберите этот автомобиль в каталоге на странице.');
              await onSelectCar(action.carId);
              if (conversationDraft) delete conversationDraft.carId;
              actionButton.textContent = 'Автомобиль выбран'; actionButton.disabled = true;
              addMessage('Автомобиль выбран. Дальше проверьте период в форме. Реальный заказ на этом демосайте не создаётся.');
            }
          } catch (error) {
            addMessage(error instanceof Error ? error.message : 'Не удалось применить выбор. Попробуйте форму на странице.');
          }
        });
        area.append(actionButton);
      }
      message.append(area);
    }
    transcript.append(message);
    while (transcript.children.length > 50) transcript.firstElementChild.remove();
    scrollTranscript();
  }
  function suggestions(values) {
    chips.replaceChildren();
    for (const value of values.slice(0, 3)) chips.append(button('chat-chip', value, () => ask(value)));
  }
  function ask(value) {
    const text = String(value || '').trim();
    if (!text) return;
    addMessage(text, 'user'); input.value = '';
    try {
      const response = answerQuestion(text, context(), { cars: getCars(), availability });
      if (response.period) conversationDraft = { ...response.period };
      addMessage(response.text, 'bot', response.actions);
      suggestions(response.suggestions);
    } catch {
      addMessage('Не удалось обработать вопрос. Попробуйте ещё раз или воспользуйтесь формой выбора автомобиля.');
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); ask(input.value); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } });
  launcher.addEventListener('keydown', event => { if (event.key === 'Escape' && isOpen) setOpen(false); });
  addMessage('Здравствуйте! Помогу выбрать период, посмотреть машины и разобраться с арендой. Здесь работает бесплатная база ответов, без языковой модели.\n\nПопробуйте: «завтра с 15:00 на 3 часа».');
  suggestions(['На 3 часа завтра', 'На несколько дней', 'Какие машины?']);
  return { open: () => setOpen(true), close: () => setOpen(false), ask: value => { setOpen(true); ask(value); }, refreshContext: () => { conversationDraft = null; } };
}
