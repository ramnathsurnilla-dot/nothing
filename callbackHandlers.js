// callbackHandlers.js

const sheets = require('./googleSheets');
const { handleStartCommand, handleMyBatchesCommand } = require('./commandHandlers');

const handleCallbackQuery = async (bot, callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const [action, ...params] = data.split('_');
    const userIdentifier = `@${callbackQuery.from.username}`;
    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    // Acknowledge the button press immediately to stop the loading icon
    bot.answerCallbackQuery(callbackQuery.id);

    switch (action) {
        case 'submitmore':
            handleStartCommand(bot, msg, true);
            break;
            
        case 'backtobatches':
            // We need to pass a fake 'msg' object that looks like a real message
            handleMyBatchesCommand(bot, { chat: { id: chatId }, from: { username: callbackQuery.from.username } });
            bot.deleteMessage(chatId, messageId); // Clean up the old message
            break;
            
        case 'viewcodes':
            const batchId = params[0];
            const batchDetails = await sheets.getBatchDetails(userIdentifier, batchId);
            if (!batchDetails) {
                return bot.editMessageText(`❌ Batch ID \`${batchId}\` not found.`, { chat_id: chatId, message_id: messageId });
            }
            let text = `📦 *Batch \`${batchId}\`*\n`;
            text += `*Type:* ${batchDetails.type} (${batchDetails.count}) | *Status:* **${batchDetails.status}**\n\n`;
            text += "```\n" + batchDetails.codes.join('\n') + "\n```";

            const keyboard = { inline_keyboard: [[{ text: "⬅️ Back to List", callback_data: 'backtobatches' }]] };
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
            break;

        case 'canceldelete':
            bot.editMessageText("👍 Action cancelled.", { chat_id: chatId, message_id: messageId });
            break;

        case 'confirmreset':
            await bot.editMessageText("⏳ Deleting all your data...", { chat_id: chatId, message_id: messageId });
            await sheets.deleteUserData(userIdentifier);
            bot.editMessageText("✅ All your data has been permanently deleted.", { chat_id: chatId, message_id: messageId });
            break;
    }
};

module.exports = { handleCallbackQuery };