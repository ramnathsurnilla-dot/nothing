// index.js

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const sheets = require('./googleSheets'); // Import our Google Sheets helper

// --- CONFIGURATION ---
const token = process.env.TELEGRAM_TOKEN;
const adminUsername = process.env.ADMIN_USERNAME;
const webhookUrl = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

const specialUserUsernames = ['@Faiyaz_ali777', '@sayed_kira'];
const MINIMUM_PAYOUT_AMOUNT = 50.00;
const CODE_TYPES_ALL_USERS = ['1000 Roblox', '800 Roblox', '400 Roblox', 'lol 575', 'ow 1k'];
const CODE_TYPES_SPECIAL_USERS = ['minecoin 330', 'lol 575', 'pc game pass', 'lol 100', 'ow 200'];

// This replaces PropertiesService for storing user state
// In a real production app, you might use a database like Redis for this
let userStates = {};

// --- BOT & SERVER INITIALIZATION ---
const bot = new TelegramBot(token);
const app = express();

// Set the webhook for Telegram to send updates to
bot.setWebHook(`${webhookUrl}/bot${token}`);

// Middleware to parse JSON bodies
app.use(express.json());

// This is our main endpoint that replaces doPost(e)
app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200); // Respond to Telegram to confirm receipt
});

console.log("Bot server started...");

// --- SHARED FUNCTIONS ---
const isUserAdmin = (username) => `@${username}` === adminUsername;
const isUserSpecial = (username) => specialUserUsernames.includes(`@${username}`);

// --- BOT EVENT LISTENERS ---

/**
 * Handles all incoming text messages
 */
bot.on('message', async (msg) => {
    // Extract useful info from the message
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const text = msg.text.trim();

    // Always record the user to keep our user list up-to-date
    await sheets.recordUser(userId, `@${username}`);

    // If the message is a command, ignore it here (the onText listeners will handle it)
    if (text.startsWith('/')) {
        return;
    }

    // Check for user state (e.g., if the bot is waiting for codes)
    const state = userStates[userId];
    if (state && state.action === 'submitting') {
        await handleCodeSubmission(chatId, userId, username, text, state);
        return;
    }

    // Check if the message is a valid code type selection
    const allCodeTypes = [...CODE_TYPES_ALL_USERS, ...CODE_TYPES_SPECIAL_USERS];
    const allowedCodeTypes = (isUserAdmin(username) || isUserSpecial(username)) 
        ? allCodeTypes 
        : CODE_TYPES_ALL_USERS;
        
    if (allowedCodeTypes.map(t => t.toLowerCase()).includes(text.toLowerCase())) {
        userStates[userId] = { action: 'submitting', type: text };
        const confirmationMessage = `✅ *Selected: ${text}*\n\nNow, please send the codes. Each code should be on a new line.`;
        bot.sendMessage(chatId, confirmationMessage, { parse_mode: 'Markdown' });
        return;
    }

    // If it's none of the above, treat it as a message to the admin
    if (!isUserAdmin(username)) {
        // This is simplified. You would need the admin's chat ID to forward the message.
        console.log(`Message from @${username} to admin: ${text}`);
    }
});


/**
 * Handles /start command
 */
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;

    // Determine which codes the user is allowed to submit
    const allowedCodeTypes = (isUserAdmin(username) || isUserSpecial(username)) 
        ? [...CODE_TYPES_ALL_USERS, ...CODE_TYPES_SPECIAL_USERS] 
        : CODE_TYPES_ALL_USERS;

    // Create a 2D array for the keyboard buttons
    const keyboardButtons = allowedCodeTypes.map(type => [type]);

    const welcomeText = `👋 *Welcome, @${username}!*\n\nTo begin, please select a code type from the menu below.`;
    const keyboard = {
        keyboard: keyboardButtons,
        resize_keyboard: true,
        one_time_keyboard: true,
        input_field_placeholder: "Select a code type to submit"
    };

    bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});


/**
 * Handles /balance command
 */
bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const loadingMessage = await bot.sendMessage(chatId, "⏳ Calculating your balance...");

    const financials = await sheets.calculateUserFinancials(userId);

    let message = `💰 *Your Balance*\n\n`;
    message += `▪️ *Priced (Withdrawable):* \`$${financials.totalNetOwed.toFixed(2)}\`\n`;
    message += `▪️ *Unpriced (Estimate):* \`~$${financials.estimatedValue.toFixed(2)}\` (*${financials.unpricedCount} codes*)\n\n`;
    message += `*Total Estimated Balance:* \`~$${financials.totalEstimatedBalance.toFixed(2)}\``;
    
    // The original script has more complex logic here with buttons, which can be added back
    bot.editMessageText(message, {
        chat_id: chatId,
        message_id: loadingMessage.message_id,
        parse_mode: 'Markdown'
    });
});


/**
 * Handles code submission text from a user
 */
async function handleCodeSubmission(chatId, userId, username, text, state) {
    const loadingMessage = await bot.sendMessage(chatId, "⏳ Validating and processing your codes...");
    
    // Split codes by new line and filter out empty lines
    const submittedCodes = text.split('\n').map(l => l.trim()).filter(Boolean);

    if (submittedCodes.length === 0) {
        bot.editMessageText("❌ *No Codes Found*\n\nPlease send at least one code.", {
            chat_id: chatId,
            message_id: loadingMessage.message_id,
            parse_mode: 'Markdown'
        });
        return;
    }
    
    try {
        const result = await sheets.handleCodeSubmission(userId, username, state.type, submittedCodes);
        
        let userMessage = `🎉 *Submission Complete for \`@${username}\`!*\n\n`;
        if (result.acceptedCount > 0) userMessage += `✅ Accepted: *${result.acceptedCount}* new '${state.type}' code(s).\n`;
        if (result.duplicateCodes.length > 0) userMessage += `🟡 Rejected *${result.duplicateCodes.length}* as duplicates.\n`;
        if (result.invalidFormatCodes.length > 0) userMessage += `🔴 Rejected *${result.invalidFormatCodes.length}* with invalid format.\n`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: `➕ Submit More (${state.type})`, callback_data: `submitsame_${state.type}` }],
                [{ text: "📝 Submit Different", callback_data: 'submitmore' }],
                [{ text: "💰 Check Balance", callback_data: 'checkbalance' }]
            ]
        };

        bot.editMessageText(userMessage, {
            chat_id: chatId,
            message_id: loadingMessage.message_id,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });

    } catch (error) {
        console.error("Error during code submission:", error);
        bot.editMessageText("❌ An error occurred while processing your submission. Please contact an admin.", {
            chat_id: chatId,
            message_id: loadingMessage.message_id
        });
    }

    // Clear the user's state
    delete userStates[userId];
}

// --- START THE SERVER ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});