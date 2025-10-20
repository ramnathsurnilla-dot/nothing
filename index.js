// index.js

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const sheets = require('./googleSheets');
const handlers = require('./commandHandlers');
const { handleCallbackQuery } = require('./callbackHandlers');

// --- BOT & SERVER INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
bot.setWebHook(`${process.env.WEBHOOK_URL}/bot${process.env.TELEGRAM_TOKEN}`);
const app = express();
app.use(express.json());

app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

console.log("Bot server started...");

// --- REGISTER COMMAND HANDLERS ---
bot.onText(/\/start/, (msg) => handlers.handleStartCommand(bot, msg));
bot.onText(/\/mybatches/, (msg) => handlers.handleMyBatchesCommand(bot, msg));
bot.onText(/\/help/, (msg) => handlers.handleHelpCommand(bot, msg));
bot.onText(/\/mydata/, (msg) => handlers.handleMyDataCommand(bot, msg));
bot.onText(/\/reset/, (msg) => handlers.handleResetCommand(bot, msg));
bot.onText(/\/profile/, (msg) => handlers.handleProfileCommand(bot, msg));
// Note: /balance, /withdraw, and admin commands are not included in this build yet.

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (msg) => {
    if (!msg.text || !msg.from || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = `@${msg.from.username}`;
    const text = msg.text.trim();

    await sheets.recordUser(userId, username);

    const state = handlers.userStates[userId];
    if (state && state.action === 'submitting') {
        return processCodeSubmission(chatId, userId, username, text, state);
    }

    const isSpecial = config.specialUserUsernames.includes(username);
    const isAdmin = config.adminUsername === username;
    const allowed = isAdmin || isSpecial ? config.VALID_CODE_TYPES : config.CODE_TYPES_ALL_USERS;
    
    if (allowed.map(t => t.toLowerCase()).includes(text.toLowerCase())) {
        handlers.userStates[userId] = { action: 'submitting', type: text };
        const message = `✅ *Selected: ${text}*\n\nNow, please send the codes. Each code should be on a new line.`;
        return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    if (!isAdmin && config.adminChatId) {
        const forwardMessage = `*Incoming Message from \`${username}\`*\n(ID: \`${userId}\`)\n\n${text}`;
        bot.sendMessage(config.adminChatId, forwardMessage, { parse_mode: 'Markdown' });
        bot.sendMessage(chatId, "✅ Your message has been sent to the admin.");
    }
});

// --- CALLBACK QUERY HANDLER ---
bot.on('callback_query', (callbackQuery) => {
    handleCallbackQuery(bot, callbackQuery);
});

// --- LOGIC FOR SUBMISSION ---
async function processCodeSubmission(chatId, userId, username, text, state) {
    const loadingMessage = await bot.sendMessage(chatId, "⏳ Validating and processing...");
    const codes = text.split('\n').map(l => l.trim()).filter(Boolean);

    try {
        const result = await sheets.handleCodeSubmission(username, state.type, codes);
        let userMessage = `🎉 *Submission Complete for \`${username}\`!*\n\n`;
        if (result.acceptedCount > 0) userMessage += `✅ Accepted: *${result.acceptedCount}* new code(s).\n`;
        if (result.duplicateCodes.length > 0) userMessage += `🟡 Rejected *${result.duplicateCodes.length}* as duplicates.\n`;
        if (result.invalidFormatCodes.length > 0) userMessage += `🔴 Rejected *${result.invalidFormatCodes.length}* with invalid format.\n`;

        bot.editMessageText(userMessage, {
            chat_id: chatId, message_id: loadingMessage.message_id, parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: "📝 Submit Different", callback_data: 'submitmore' }
                ]]
            }
        });
    } catch (error) {
        bot.editMessageText(`❌ An error occurred: \`${error.message}\``, {
            chat_id: chatId, message_id: loadingMessage.message_id, parse_mode: 'Markdown'
        });
    }
    delete handlers.userStates[userId];
}

// --- START THE SERVER ---
app.listen(process.env.PORT || 3000, () => {
    console.log(`Server is listening...`);
});