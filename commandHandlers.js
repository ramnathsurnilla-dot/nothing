// commandHandlers.js

const config = require('./config');
const sheets = require('./googleSheets');

// In-memory state store
const userStates = {};

const handleStartCommand = (bot, msg) => {
    const chatId = msg.chat.id;
    const userIdentifier = `@${msg.from.username}`;
    const isAdmin = config.adminUsername === userIdentifier;
    const isSpecial = config.specialUserUsernames.includes(userIdentifier);
    const allowed = isAdmin || isSpecial ? config.VALID_CODE_TYPES : config.CODE_TYPES_ALL_USERS;
    
    bot.sendMessage(chatId, `👋 *Welcome, ${userIdentifier}!*`, { parse_mode: 'Markdown' });
    bot.sendMessage(chatId, "👇 Please select an item to submit.", {
        reply_markup: {
            keyboard: allowed.map(type => [type]),
            resize_keyboard: true,
            one_time_keyboard: true,
            input_field_placeholder: "Select a code type to submit"
        }
    });
};

const handleMyBatchesCommand = async (bot, msg) => {
    const chatId = msg.chat.id;
    const userIdentifier = `@${msg.from.username}`;
    const loadingMessage = await bot.sendMessage(chatId, "⏳ Fetching your batches...");

    const batches = await sheets.aggregateUserBatches(userIdentifier);
    if (Object.keys(batches).length === 0) {
        return bot.editMessageText("ℹ️ You have no submission batches.", { chat_id: chatId, message_id: loadingMessage.message_id });
    }

    const sortedBatchIds = Object.keys(batches).sort((a, b) => b - a).slice(0, 15);
    let message = "📦 *Your Recent Submission Batches*\n\n";
    const keyboard = sortedBatchIds.map(batchId => {
        const batch = batches[batchId];
        message += `*ID:* \`${batchId}\` | *Type:* ${batch.type} (${batch.count}) | *Status:* **${batch.status}**\n`;
        return [{ text: `📄 View Batch ${batchId}`, callback_data: `viewcodes_${batchId}` }];
    });
    
    bot.editMessageText(message, {
        chat_id: chatId, message_id: loadingMessage.message_id, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
};

const handleHelpCommand = (bot, msg) => {
    const isAdmin = config.adminUsername === `@${msg.from.username}`;
    let text = "❓ *Bot Commands*\n\n";
    text += "*/start* - Submit a new code.\n";
    text += "*/balance* - Check your priced and unpriced earnings.\n";
    text += "*/profile* - View your full profile and submission stats.\n";
    text += "*/mybatches* - View the status of your recent submissions.\n";
    text += "*/mydata* - Receive a CSV file with all your submissions.\n";
    text += "*/reset* - Permanently delete all your data.\n";
    text += "*/cancel* - Cancel the current action.\n";
    if (isAdmin) {
        text += "\n\n*Admin Commands*\n";
        text += "*/summaryall* - Get a live summary for all users.\n";
        text += "*/broadcast* - Send a message to all users.\n";
    }
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
};

const handleMyDataCommand = async (bot, msg) => {
    const userIdentifier = `@${msg.from.username}`;
    await bot.sendMessage(msg.chat.id, "⏳ Preparing your data file...");
    const csvContent = await sheets.getUserDataAsCsv(userIdentifier);
    if (!csvContent) return bot.sendMessage(msg.chat.id, "ℹ️ You have no data to export.");
    bot.sendDocument(msg.chat.id, Buffer.from(csvContent), {}, {
        filename: `data_export_${userIdentifier.substring(1)}.csv`,
        contentType: 'text/csv'
    });
};

const handleResetCommand = (bot, msg) => {
    bot.sendMessage(msg.chat.id, "‼️ *WARNING: Data Deletion*\n\nAre you sure you want to delete ALL of your data? This is irreversible.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: "⚠️ Yes, Delete All My Data", callback_data: 'confirmreset' },
                { text: "✖️ Cancel", callback_data: 'canceldelete' }
            ]]
        }
    });
};

const handleProfileCommand = async (bot, msg) => {
    const userIdentifier = `@${msg.from.username}`;
    const financials = await sheets.calculateUserFinancials(userIdentifier);
    let message = `👤 *Profile for ${userIdentifier}*\n\n`;
    message += `📈 *Total Submissions:* \`${financials.totalSubmissions}\`\n`;
    message += `💰 *Withdrawable Balance:* \`$${financials.totalNetOwed.toFixed(2)}\`\n`;
    message += `⏳ *Unpriced Codes:* \`${financials.unpricedCount}\`\n\n`;
    message += "📊 *Submissions by Type*\n";
    for (const type in financials.typeStats) {
        const stats = financials.typeStats[type];
        message += `  - *${type}*: ${stats.total} total\n`;
    }
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
};

const handleBalanceCommand = async (bot, msg) => {
    const userIdentifier = `@${msg.from.username}`;
    const financials = await sheets.calculateUserFinancials(userIdentifier);
    let message = `💰 *Your Balance*\n\n`;
    message += `▪️ *Priced (Withdrawable):* \`$${financials.totalNetOwed.toFixed(2)}\`\n`;
    message += `▪️ *Unpriced Codes:* \`${financials.unpricedCount}\`\n`;
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
};

const handleCancelCommand = (bot, msg) => {
    delete userStates[msg.from.id];
    bot.sendMessage(msg.chat.id, "✅ Action cancelled.");
};

// --- ADMIN COMMANDS ---
const handleBroadcastCommand = async (bot, msg) => {
    if (config.adminUsername !== `@${msg.from.username}`) return;
    bot.sendMessage(msg.chat.id, "📣 *Broadcast Mode*\nPlease send the message you want to broadcast.");
    userStates[msg.from.id] = { action: 'awaiting_broadcast' };
};

module.exports = {
    userStates,
    handleStartCommand,
    handleMyBatchesCommand,
    handleHelpCommand,
    handleMyDataCommand,
    handleResetCommand,
    handleProfileCommand,
    handleBalanceCommand,
    handleCancelCommand,
    handleBroadcastCommand,
};