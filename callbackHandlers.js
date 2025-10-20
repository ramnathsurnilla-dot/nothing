// callbackHandlers.js

const sheets = require('./googleSheets');
const { handleStartCommand, handleMyBatchesCommand } = require('./commandHandlers');

const handleCallbackQuery = async (bot, cbq) => {
    const msg = cbq.message;
    const [action, ...params] = cbq.data.split('_');
    const userIdentifier = `@${cbq.from.username}`;
    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    bot.answerCallbackQuery(cbq.id);

    switch (action) {
        case 'submitmore':
            handleStartCommand(bot, { chat: { id: chatId }, from: { username: cbq.from.username } }, true);
            break;
            
        case 'backtobatches':
            handleMyBatchesCommand(bot, { chat: { id: chatId }, from: { username: cbq.from.username } });
            bot.deleteMessage(chatId, messageId);
            break;
            
        case 'viewcodes':
            const batchId = params[0];
            const batchDetails = await sheets.getBatchDetails(userIdentifier, batchId);
            if (!batchDetails) return bot.editMessageText(`❌ Batch ID \`${batchId}\` not found.`, { chatId, messageId });
            
            let text = `📦 *Batch \`${batchId}\`*\n`;
            text += `*Type:* ${batchDetails.type} | *Status:* **${batchDetails.status}**\n\n`;
            text += "```\n" + batchDetails.codes.join('\n') + "\n```";
            bot.editMessageText(text, { chatId, messageId, parse_mode: 'Markdown', reply_markup: {
                inline_keyboard: [[{ text: "⬅️ Back to List", callback_data: 'backtobatches' }]]
            }});
            break;

        case 'canceldelete':
            bot.editMessageText("👍 Action cancelled.", { chatId, messageId });
            break;

        case 'confirmreset':
            await bot.editMessageText("⏳ Deleting all your data...", { chatId, messageId });
            await sheets.deleteUserDataSheet(userIdentifier);
            bot.editMessageText("✅ All your data has been permanently deleted.", { chatId, messageId });
            break;
    }
};

module.exports = { handleCallbackQuery };   