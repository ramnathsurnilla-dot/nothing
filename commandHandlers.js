// commandHandlers.js

const config = require('./config');
const sheets = require('./googleSheets');

// In-memory user state, replace with Redis in production for scalability
let userStates = {};

const handleStartCommand = (bot, msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    const userIdentifier = `@${username}`;

    const isSpecial = config.specialUserUsernames.includes(userIdentifier);
    const isAdmin = config.adminUsername === userIdentifier;
    
    const allowed = isAdmin || isSpecial
        ? config.VALID_CODE_TYPES
        : config.CODE_TYPES_ALL_USERS;

    const keyboardButtons = allowed.map(type => [type]);
    const welcomeText = `👋 *Welcome, ${userIdentifier}!*`;
    bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    bot.sendMessage(chatId, "👇 Please select an item to submit.", {
        reply_markup: {
            keyboard: keyboardButtons,
            resize_keyboard: true,
            one_time_keyboard: true,
            input_field_placeholder: "Select a code type to submit"
        }
    });
};

const handleMyBatchesCommand = async (bot, msg) => {
    const chatId = msg.chat.id;
    const userIdentifier = `@${msg.from.username}`;
    const loadingMessage = await bot.sendMessage(chatId, "⏳ Fetching your batch information...");

    const batches = await sheets.aggregateUserBatches(userIdentifier);
    if (Object.keys(batches).length === 0) {
        return bot.editMessageText("ℹ️ You have not submitted any codes yet.", { chat_id: chatId, message_id: loadingMessage.message_id });
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
    const username = `@${msg.from.username}`;
    const isAdmin = config.adminUsername === username;
    let text = "❓ *Bot Commands*\n\n";
    text += "*/start* - Submit a new code.\n";
    text += "*/balance* - Check your priced and unpriced earnings.\n";
    text += "*/withdraw* - Request a payout of your available balance.\n";
    text += "*/profile* - View your full profile and submission stats.\n";
    text += "*/mybatches* - View the status of your recent submissions.\n";
    text += "*/mydata* - Receive a CSV file with all your submissions.\n";
    text += "*/reset* - Permanently delete all your data.\n";
    text += "\nYou can also send any message to chat directly with the admin.";

    if (isAdmin) {
        text += "\n\n*Admin Commands*\n";
        text += "*/summaryall* - Get a live summary for all users.\n";
        text += "*/broadcast* - Send a message to all users.\n";
        // Add more admin command descriptions here
    }
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
};

const handleMyDataCommand = async (bot, msg) => {
    const chatId = msg.chat.id;
    const userIdentifier = `@${msg.from.username}`;
    await bot.sendMessage(chatId, "⏳ Preparing your data file...");
    const csvContent = await sheets.getUserDataAsCsv(userIdentifier);

    if (!csvContent) {
        return bot.sendMessage(chatId, "ℹ️ You have no data to export.");
    }
    const fileName = `data_export_${userIdentifier.substring(1)}.csv`;
    const fileOptions = { filename: fileName, contentType: 'text/csv' };
    bot.sendDocument(chatId, Buffer.from(csvContent), {}, fileOptions);
};

const handleResetCommand = (bot, msg) => {
    const chatId = msg.chat.id;
    const keyboard = {
        inline_keyboard: [[
            { text: "⚠️ Yes, Delete All My Data", callback_data: 'confirmreset' },
            { text: "✖️ Cancel", callback_data: 'canceldelete' }
        ]]
    };
    bot.sendMessage(chatId, "‼️ *WARNING: Data Deletion*\n\nAre you sure you want to delete ALL of your data? This is irreversible.", {
        parse_mode: 'Markdown', reply_markup: keyboard
    });
};

const handleProfileCommand = async (bot, msg) => {
    const chatId = msg.chat.id;
    const userIdentifier = `@${msg.from.username}`;
    const financials = await sheets.calculateUserFinancials(userIdentifier);

    let message = `👤 *Profile for ${userIdentifier}*\n\n`;
    message += `*--- Lifetime Stats ---*\n`;
    message += `📈 *Total Submissions:* \`${financials.totalSubmissions}\`\n\n`;
    message += `*--- Payout Summary ---*\n`;
    message += `💰 *Withdrawable Balance:* \`$${financials.totalNetOwed.toFixed(2)}\`\n`;
    message += `⏳ *Unpriced Codes:* \`${financials.unpricedCount}\`\n\n`;
    
    let personalStatsMessage = "📊 *Your Personal Stats by Type*\n\n";
    for (const type in financials.typeStats) {
        const stats = financials.typeStats[type];
        personalStatsMessage += `*${type}:*\n`;
        personalStatsMessage += `  - Priced: \`${stats.priced}\`, Unpriced: \`${stats.unpriced}\`, Total: \`${stats.total}\`\n`;
    }
    message += personalStatsMessage;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
};


module.exports = {
    handleStartCommand,
    handleMyBatchesCommand,
    handleHelpCommand,
    handleMyDataCommand,
    handleResetCommand,
    handleProfileCommand,
    userStates, // Export state to be used by the main index.js
};