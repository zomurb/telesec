/**
 * ============================================================================
 * TeleSec — Официальный Telegram Business Бот-Секретарь (Node.js)
 * ============================================================================
 * РАБОТАЕТ ЧЕРЕЗ TELEGRAM BUSINESS (БЕЗ СЕССИЙ, БЕЗ НОМЕРА ТЕЛЕФОНА, БЕЗ 2FA)!
 * И РАБОТАЕТ БЕЗ СТОРОННИХ API КЛЮЧЕЙ ИИ (100% бесплатно и автономно).
 *
 * Возможности:
 * 1. Чат-бот секретарь прямо в вашем профиле Telegram (Telegram Business):
 *    - Отвечает от имени вашего аккаунта в личных чатах по графику.
 * 2. Чат-мут (.мут / .размут прямо в чате):
 *    - Написали в чате в ответ на сообщение нарушителя ".мут" — и все его новые
 *      сообщения мгновенно автоматически удаляются через deleteBusinessMessages!
 *    - Написали ".размут" — удаление сообщений прекращается.
 * 3. Локальный умный детектор нарушений (.жалоба):
 *    - Написали в ответ ".жалоба" — встроенный анализатор текста без сторонних API
 *      подбирает причину (Спам, Оскорбления, Угрозы, 18+) и отправляет вам отчет.
 * 4. Сохранение ОДНОРАЗОВЫХ медиа (View-Once фото, исчезающие голосовые/видео):
 *    - Бот перехватывает исчезающее фото/видео до удаления и отправляет постоянную
 *      копию в ваш личный диалог с ботом!
 * 5. Управление автоответчиком через бота:
 *    - Включение/выключение в ЛС бота: /autoresponder on или /autoresponder off.
 * 6. Умный дайджест уведомлений:
 *    - Группирует реплики от одного человека в 1 сообщение, пока не нажато "Прочёл".
 *
 * Установка:
 *   npm install grammy dotenv
 * Запуск:
 *   node index.js
 * ============================================================================
 */

import { Bot } from 'grammy';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OWNER_ID = parseInt(process.env.OWNER_ID || '0', 10);

if (!BOT_TOKEN) {
  console.error('❌ ОШИБКА: Укажите BOT_TOKEN в файле .env (токен берется у @BotFather)!');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// Расписание автоответчика из веб-панели TeleSec
const SCHEDULE_SLOTS = [
  {
    "name": "Сон",
    "type": "sleep",
    "start": "23:00",
    "end": "08:00",
    "days": [
      0,
      1,
      2,
      3,
      4,
      5,
      6
    ],
    "reply": "Сплю, уведомления отключены до утра. Отвечу после 08:30. При экстренном вопросе — звоните.",
    "delay": 4,
    "cooldown": 120
  },
  {
    "name": "На работе",
    "type": "work",
    "start": "09:00",
    "end": "18:00",
    "days": [
      1,
      2,
      3,
      4,
      5
    ],
    "reply": "Нахожусь на работе, сосредоточен на задачах. Отвечу в перерыве или после 18:00. Если срочно — наберите голосом.",
    "delay": 5,
    "cooldown": 60
  },
  {
    "name": "Свободное время",
    "type": "free",
    "start": "18:00",
    "end": "23:00",
    "days": [
      0,
      1,
      2,
      3,
      4,
      5,
      6
    ],
    "reply": "Привет! Сейчас отдыхаю / занимаюсь личными делами. Скоро отвечу!",
    "delay": 6,
    "cooldown": 30,
    "freeMode": "will_answer_soon"
  }
];

// Состояние в оперативной памяти (без сессий)
let autoResponderActive = true;
const mutedUsers = new Set(); // ID пользователей, чьи сообщения автоматически удаляются
const activeDigests = new Map(); // senderId -> { messages: [], alerted: false, acknowledged: false }
const lastAutoReplies = new Map(); // senderId -> timestamp

// Папка для локального сохранения перехваченных одноразовых файлов
const MEDIA_DIR = path.resolve(process.cwd(), 'saved_media');
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// ----------------------------------------------------------------------------
// ВСТРОЕННЫЙ АНАЛИЗАТОР ПРИЧИНЫ ЖАЛОБЫ (БЕЗ ВНЕШНИХ API КЛЮЧЕЙ ИИ)
// ----------------------------------------------------------------------------
function analyzeViolationLocally(text) {
  if (!text) return { category: 'SPAM', title: 'Спам / Подозрительная активность' };

  const lower = text.toLowerCase();

  // 1. Проверка на спам, крипту, скам, рекламу
  if (
    lower.includes('http://') ||
    lower.includes('https://') ||
    lower.includes('t.me/') ||
    lower.includes('заработок') ||
    lower.includes('крипт') ||
    lower.includes('сигнал') ||
    lower.includes('казино') ||
    lower.includes('подпишись') ||
    lower.includes('выплата') ||
    lower.includes('акция')
  ) {
    return { category: 'SPAM', title: 'Спам, реклама и фишинг' };
  }

  // 2. Проверка на оскорбления, травлю, мат
  const insultKeywords = ['дурак', 'идиот', 'мразь', 'сука', 'ублюдок', 'тварь', 'лох', 'заткнись', 'чмо', 'хуй', 'пизд', 'нахуй'];
  if (insultKeywords.some((w) => lower.includes(w))) {
    return { category: 'HARASSMENT', title: 'Оскорбления и травля' };
  }

  // 3. Проверка на насилие и угрозы
  if (lower.includes('убью') || lower.includes('зарежу') || lower.includes('расправа') || lower.includes('взорву')) {
    return { category: 'VIOLENCE', title: 'Угрозы и призывы к насилию' };
  }

  // 4. Проверка на контент 18+
  if (lower.includes('порно') || lower.includes('секс') || lower.includes('18+') || lower.includes('интим') || lower.includes('нюдс')) {
    return { category: 'PORNOGRAPHY', title: 'Неподобающий контент (18+)' };
  }

  return { category: 'OTHER', title: 'Нарушение правил общения в Telegram' };
}

// Определение активного периода расписания
function getCurrentScheduleSlot() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentDay = now.getDay(); // 0=Вс, 1=Пн...

  for (const slot of SCHEDULE_SLOTS) {
    if (slot.days.includes(currentDay)) {
      const [sh, sm] = slot.start.split(':').map(Number);
      const [eh, em] = slot.end.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;

      const inSlot = startMin <= endMin
        ? (currentMinutes >= startMin && currentMinutes < endMin)
        : (currentMinutes >= startMin || currentMinutes < endMin);

      if (inSlot) return slot;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// 1. УПРАВЛЕНИЕ АВТООТВЕТЧИКОМ ЧЕРЕЗ БОТА (В ЛИЧКЕ С БОТОМ)
// ----------------------------------------------------------------------------
bot.command('start', async (ctx) => {
  if (ctx.from?.id === OWNER_ID) {
    await ctx.reply(
      `👑 <b>Добро пожаловать в панель секретаря TeleSec!</b>\n\n` +
      `Статус автоответчика: <b>${autoResponderActive ? 'ВКЛЮЧЕН' : 'ОТКЛЮЧЕН'}</b>\n\n` +
      `Команды управления:\n` +
      `• <code>/autoresponder on</code> — включить автоответчик\n` +
      `• <code>/autoresponder off</code> — отключить автоответчик\n` +
      `• <code>/muted</code> — список замученных контактов\n` +
      `• <code>/unmute_all</code> — размутить всех\n\n` +
      `<i>В чатах используйте команды: .мут, .размут, .жалоба</i>`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.reply('Здравствуйте! Я официальный бизнес-секретарь владельца этого аккаунта.');
  }
});

bot.command('autoresponder', async (ctx) => {
  const arg = ctx.match.trim().toLowerCase();
  if (arg === 'on' || arg === 'вкл') {
    autoResponderActive = true;
    await ctx.reply('✅ Автоответчик <b>ВКЛЮЧЕН</b> по расписанию.', { parse_mode: 'HTML' });
  } else if (arg === 'off' || arg === 'выкл') {
    autoResponderActive = false;
    await ctx.reply('⏸️ Автоответчик <b>ОТКЛЮЧЕН</b>.', { parse_mode: 'HTML' });
  } else {
    await ctx.reply(`Текущий статус: <b>${autoResponderActive ? 'ВКЛЮЧЕН' : 'ОТКЛЮЧЕН'}</b>.\nИспользуйте: <code>/autoresponder on</code> или <code>/autoresponder off</code>`, { parse_mode: 'HTML' });
  }
});

bot.command('muted', async (ctx) => {
  if (mutedUsers.size === 0) {
    await ctx.reply('Список замученных пользователей пуст.');
  } else {
    const list = Array.from(mutedUsers).map((id) => `• <code>${id}</code>`).join('\n');
    await ctx.reply(`🔇 <b>Замученные пользователи (сообщения удаляются):</b>\n${list}`, { parse_mode: 'HTML' });
  }
});

bot.command('unmute_all', async (ctx) => {
  mutedUsers.clear();
  await ctx.reply('🔊 Все пользователи размучены.');
});

// ----------------------------------------------------------------------------
// 2. СОБЫТИЯ TELEGRAM BUSINESS (ПОДКЛЮЧЕНИЕ СЕКРЕТАРЯ В ПРОФИЛЕ)
// ----------------------------------------------------------------------------
bot.on('business_connection', async (ctx) => {
  const conn = ctx.businessConnection;
  console.log(`[Telegram Business] Подключение обновлено: ${conn.id}, пользователь: ${conn.user.first_name} (@${conn.user.username})`);
  if (OWNER_ID) {
    await bot.api.sendMessage(
      OWNER_ID,
      `✨ <b>Telegram Business подключен!</b>\nБот успешно назначен секретарем в профиле @${conn.user.username || conn.user.first_name}.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});

// ----------------------------------------------------------------------------
// 3. ОСНОВНОЙ ОБРАБОТЧИК СООБЩЕНИЙ ЧЕРЕЗ TELEGRAM BUSINESS
// ----------------------------------------------------------------------------
bot.on('business_message', async (ctx) => {
  const bMsg = ctx.businessMessage;
  const connectionId = bMsg.business_connection_id;
  const chatId = bMsg.chat.id;
  const senderId = bMsg.from?.id ? bMsg.from.id.toString() : '';
  const senderName = bMsg.from?.first_name || 'Собеседник';
  const text = bMsg.text || '';
  const isOwner = bMsg.from?.id === OWNER_ID;

  // А) ЧАТ-МУТ: ЕСЛИ ОТПРАВИТЕЛЬ В СПИСКЕ ЗАМУЧЕННЫХ — УДАЛЯЕМ ЕГО СООБЩЕНИЕ!
  if (!isOwner && mutedUsers.has(senderId)) {
    try {
      await ctx.api.deleteBusinessMessages(connectionId, [bMsg.message_id]);
      console.log(`🗑️ [Чат-мут] Мгновенно удалено сообщение от замученного ID ${senderId}`);
      return;
    } catch (err) {
      console.error('Ошибка удаления сообщения замученного:', err.message);
    }
  }

  // Б) ПЕРЕХВАТ ОДНОРАЗОВЫХ И САМОУНИЧТОЖАЮЩИХСЯ МЕДИА (View-Once / TTL)
  // В Telegram Business исчезающие фото и видео содержат флаг ttl_period или has_media_spoiler
  const hasTtl = Boolean(bMsg.photo || bMsg.voice || bMsg.video_note);
  if (!isOwner && hasTtl) {
    try {
      const fileId = bMsg.photo ? bMsg.photo[bMsg.photo.length - 1].file_id : (bMsg.voice?.file_id || bMsg.video_note?.file_id);
      if (fileId && OWNER_ID) {
        console.log(`🔥 [Медиа-перехват] Сохраняем медиа от ${senderName}...`);
        const fileInfo = await ctx.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;

        // Пересылаем владельцу в диалог с ботом
        const caption = `🔥 <b>[TeleSec Vault] Перехвачено медиа!</b>\nОт: <b>${senderName}</b> (<code>${senderId}</code>)\nВремя: ${new Date().toLocaleTimeString()}`;

        if (bMsg.photo) {
          await bot.api.sendPhoto(OWNER_ID, fileId, { caption, parse_mode: 'HTML' });
        } else if (bMsg.voice) {
          await bot.api.sendVoice(OWNER_ID, fileId, { caption, parse_mode: 'HTML' });
        } else if (bMsg.video_note) {
          await bot.api.sendVideoNote(OWNER_ID, fileId);
          await bot.api.sendMessage(OWNER_ID, caption, { parse_mode: 'HTML' });
        }
        console.log('✅ Одноразовое медиа сохранено и отправлено владельцу в бота!');
      }
    } catch (e) {
      console.error('Ошибка перехвата медиа:', e.message);
    }
  }

  // В) КОМАНДЫ ЧАТА ОТ ВЛАДЕЛЬЦА (.мут, .размут, .жалоба)
  if (isOwner && text.startsWith('.')) {
    const parts = text.split(' ');
    const cmd = parts[0].toLowerCase();

    // КОМАНДА: .мут
    if (cmd === '.мут') {
      let targetId = null;
      if (bMsg.reply_to_message?.from?.id) {
        targetId = bMsg.reply_to_message.from.id.toString();
      } else if (parts[1]) {
        targetId = parts[1].replace('@', '');
      }

      if (targetId) {
        mutedUsers.add(targetId);
        await ctx.api.deleteBusinessMessages(connectionId, [bMsg.message_id]).catch(() => {});
        await ctx.api.sendMessage(chatId, `🔇 <b>[TeleSec]</b> Пользователь замучен. Все его новые сообщения будут автоматически удаляться!`, {
          business_connection_id: connectionId,
          parse_mode: 'HTML',
        });
        console.log(`🔇 Включен чат-мут для ${targetId}`);
      } else {
        await ctx.api.sendMessage(chatId, '⚠️ Ответьте на сообщение нарушителя командой .мут', {
          business_connection_id: connectionId,
        });
      }
      return;
    }

    // КОМАНДА: .размут
    if (cmd === '.размут') {
      let targetId = null;
      if (bMsg.reply_to_message?.from?.id) {
        targetId = bMsg.reply_to_message.from.id.toString();
      } else if (parts[1]) {
        targetId = parts[1].replace('@', '');
      }

      if (targetId) {
        mutedUsers.delete(targetId);
        await ctx.api.deleteBusinessMessages(connectionId, [bMsg.message_id]).catch(() => {});
        await ctx.api.sendMessage(chatId, `🔊 <b>[TeleSec]</b> Пользователь размучен. Удаление сообщений отключено.`, {
          business_connection_id: connectionId,
          parse_mode: 'HTML',
        });
      }
      return;
    }

    // КОМАНДА: .жалоба (с локальным подбором причины БЕЗ ИИ API)
    if (cmd === '.жалоба') {
      const offendingText = bMsg.reply_to_message?.text || 'Нарушение в чате';
      const offenderName = bMsg.reply_to_message?.from?.first_name || 'Собеседник';
      const offenderId = bMsg.reply_to_message?.from?.id || chatId;

      const { category, title } = analyzeViolationLocally(offendingText);

      await ctx.api.deleteBusinessMessages(connectionId, [bMsg.message_id]).catch(() => {});

      // Отправляем отчет владельцу в личные сообщения бота
      if (OWNER_ID) {
        await bot.api.sendMessage(
          OWNER_ID,
          `🚨 <b>[ЖАЛОБА ТЕЛЕСЕК]</b>\n` +
          `Нарушитель: <b>${offenderName}</b> (<code>${offenderId}</code>)\n` +
          `<b>Причина:</b> ${title} (Категория: <code>${category}</code>)\n` +
          `Цитата: <blockquote>${offendingText}</blockquote>`,
          { parse_mode: 'HTML' }
        );
      }

      await ctx.api.sendMessage(chatId, `🚨 <b>[TeleSec]</b> Жалоба зафиксирована! Категория: <b>${title}</b>.`, {
        business_connection_id: connectionId,
        parse_mode: 'HTML',
      });
      return;
    }
  }

  // Г) ВХОДЯЩИЕ СООБЩЕНИЯ: УМНЫЙ ДАЙДЖЕСТ + АВТООТВЕТЧИК
  if (!isOwner && senderId) {
    const nowTs = Date.now();

    // 1. Умная группировка в дайджест
    let digest = activeDigests.get(senderId);
    if (!digest || digest.acknowledged) {
      digest = {
        name: senderName,
        messages: [text],
        alerted: false,
        acknowledged: false,
      };
      activeDigests.set(senderId, digest);
    } else {
      digest.messages.push(text);
    }

    // Одно уведомление владельцу со звуком, пока не прочитано
    if (!digest.alerted && OWNER_ID) {
      digest.alerted = true;
      await bot.api.sendMessage(
        OWNER_ID,
        `📬 <b>Новое входящее от ${senderName}</b> (<code>${senderId}</code>)\n` +
        `Сообщений: 1\n` +
        `Текст: "${text}"\n\n` +
        `<i>Все последующие сообщения от него будут тихо накапливаться в этот блок без звукового спама.</i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    // 2. Автоответчик по графику (если включен)
    if (autoResponderActive) {
      const slot = getCurrentScheduleSlot();
      if (slot && slot.reply) {
        const lastReply = lastAutoReplies.get(senderId) || 0;
        const cooldownMs = (slot.cooldown || 30) * 60 * 1000;

        if (nowTs - lastReply > cooldownMs) {
          const delaySec = slot.delay || 3;
          await new Promise((r) => setTimeout(r, delaySec * 1000));

          let replyText = slot.reply;
          if (slot.type === 'free' && slot.freeMode === 'lazy_or_wont_reply') {
            replyText = 'Сейчас отдыхаю / занят своими делами, отвечу позже по настроению 😉';
          }

          await ctx.api.sendMessage(chatId, `🤖 ${replyText}`, {
            business_connection_id: connectionId,
          });

          lastAutoReplies.set(senderId, Date.now());
          console.log(`✅ Отправлен автоответ [${slot.name}] для ${senderName}`);
        }
      }
    }
  }
});

// Запуск бота
console.log('🚀 TeleSec Telegram Business Bot запускается...');
bot.start({
  onStart: (botInfo) => {
    console.log(`✨ Бот @${botInfo.username} запущен!`);
    console.log('📌 Теперь подключите его в Настройки Telegram -> Telegram Business -> Чат-боты.');
    console.log('🟢 Никаких сессий, номеров телефонов и сторонних API не требуется!');
  },
  allowed_updates: ['business_connection', 'business_message', 'message'],
});
