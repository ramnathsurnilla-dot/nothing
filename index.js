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

// --- REGISTER COMMANDS ---
bot.onText(/\/start/, (msg) => handlers.handleStartCommand(bot, msg));
bot.onText(/\/mybatches/, (msg) => handlers.handleMyBatchesCommand(bot, msg));
bot.onText(/\/help/, (msg) => handlers.handleHelpCommand(bot, msg));
bot.onText(/\/mydata/, (msg) => handlers.handleMyDataCommand(bot, msg));
bot.onText(/\/reset/, (msg) => handlers.handleResetCommand(bot, msg));
bot.onText(/\/profile/, (msg) => handlers.handleProfileCommand(bot, msg));
bot.onText(/\/balance/, (msg) => handlers.handleBalanceCommand(bot, msg));
bot.onText(/\/cancel/, (msg) => handlers.handleCancelCommand(bot, msg));
bot.onText(/\/broadcast/, (msg) => handlers.handleBroadcastCommand(bot, msg));

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (msg) => {
    if (!msg.text || !msg.from || msg.text.startsWith('/')) return;

    const { id: userId, username } = msg.from;
    const { id: chatId } = msg.chat;
    const text = msg.text.trim();
    const userIdentifier = `@${username}`;

    await sheets.recordUser(userId, userIdentifier);
    const state = handlers.userStates[userId];

    // Handle stateful actions (e.g., waiting for codes or broadcast message)
    if (state) {
        if (state.action === 'submitting') {
            return processCodeSubmission(chatId, userId, userIdentifier, text, state);
        }
        if (state.action === 'awaiting_broadcast' && config.adminUsername === userIdentifier) {
            delete handlers.userStates[userId]; // Clear state
            const users = await sheets.getUsers();
            bot.sendMessage(chatId, `📣 Broadcasting to ${Object.keys(users.byId).length} users...`);
            for (const id in users.byId) {
                if (id !== String(userId)) { // Don't send to admin
                    try {
                        await bot.sendMessage(id, text);
                    } catch (error) {
                        console.log(`Failed to send broadcast to user ${id}: ${error.message}`);
                    }
                }
            }
            return bot.sendMessage(chatId, "✅ Broadcast complete.");
        }
    }
    
    // Handle code type selection
    if (config.VALID_CODE_TYPES.map(t => t.toLowerCase()).includes(text.toLowerCase())) {
        handlers.userStates[userId] = { action: 'submitting', type: text };
        return bot.sendMessage(chatId, `✅ *Selected: ${text}*\n\nNow, please send the codes.`, { parse_mode: 'Markdown' });
    }

    // Forward to admin if no other action is matched
    if (config.adminUsername !== userIdentifier && config.adminChatId) {
        const forwardMessage = `*Incoming from \`${userIdentifier}\`* (ID: \`${userId}\`)\n\n${text}`;
        bot.sendMessage(config.adminChatId, forwardMessage, { parse_mode: 'Markdown' });
        bot.sendMessage(chatId, "✅ Your message has been sent to the admin.");
    }
});

// --- CALLBACK QUERY HANDLER ---
bot.on('callback_query', (cbq) => handleCallbackQuery(bot, cbq));

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
                inline_keyboard: [[{ text: "📝 Submit Different", callback_data: 'submitmore' }]]
            }
        });
    } catch (error) {
        bot.editMessageText(`❌ An error occurred: \`${error.message}\``, {
            chat_id: chatId, message_id: loadingMessage.message_id, parse_mode: 'Markdown'
        });
    }
    delete handlers.userStates[userId];
}

// --- START SERVER ---
app.listen(process.env.PORT || 3000, () => console.log(`Server is listening...`));