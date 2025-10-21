// =================================================================================
// =================== PART 1 of 6: Configuration and Initial Setup ================
// =================================================================================

// --- Environment and Dependencies ---
require('dotenv').config(); // Loads SPREADSHEET_ID from .env file
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./credentials.json'); // Your service account credentials

// --- Bot Configuration ---
const telegramToken = '8012735434:AAFuPm2Wni1SEZsrka9UMF7D5j1Xba3bbm0';
const adminUsername = '@Oukira';
const specialUserUsernames = ['@Faiyaz_ali777', '@sayed_kira'];
const MINIMUM_PAYOUT_AMOUNT = 50.00;

// --- Sheet Configuration ---
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
if (!SPREADSHEET_ID) {
    console.error("FATAL: SPREADSHEET_ID is not defined in the .env file. Please create a .env file and add it.");
    process.exit(1); // Exit if the spreadsheet ID is missing
}
const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

// Define the titles and headers for all the sheets we will use
const USERS_SHEET_TITLE = '_users';
const USERS_SHEET_HEADERS = ['UserID', 'Username'];
const PAYMENTS_LOG_SHEET_TITLE = '_payments_log';
const PAYMENTS_LOG_HEADERS = ["TransactionID", "Timestamp", "UserID", "Username", "Amount", "Admin", "Note"];
const USER_SHEET_HEADERS = ["Code", "Type", "Timestamp", "Price", "Batch ID", "Status", "Note"];

// --- Code & API Configuration ---
const CODE_TYPES_ALL_USERS = ['1000 Roblox', '800 Roblox', '400 Roblox', 'lol 575', 'ow 1k'];
const CODE_TYPES_SPECIAL_USERS = ['minecoin 330', 'lol 575', 'pc game pass', 'lol 100', 'ow 200'];
const VALID_CODE_TYPES = [...new Set([...CODE_TYPES_ALL_USERS, ...CODE_TYPES_SPECIAL_USERS])];
const CODE_PATTERN_REGEX = /^[a-zA-Z0-9-]{5,}$/;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${telegramToken}`;

// --- In-Memory Caching and State Management ---
class SimpleStore {
    constructor() { this.store = {}; }
    getProperty(key) { return this.store[key]; }
    setProperty(key, value) { this.store[key] = value; }
    removeProperty(key) { delete this.store[key]; }
    removeAll(keys) { keys.forEach(key => this.removeProperty(key)); }
}
const props = new SimpleStore(); // Stores temporary user states (e.g., 'awaiting_price')
const cache = new SimpleStore(); // Stores cached data from sheets to reduce API calls

// =================================================================================
// =================== PART 2 of 6: Google Sheets Database Layer ===================
// =================================================================================

/**
 * Authenticates with the Google Sheets API using service account credentials.
 * This should only be called ONCE at startup.
 */
async function initializeAuth() {
    try {
        // Use service account credentials directly
        doc.useServiceAccountAuth(creds);
        await doc.loadInfo(); // Loads spreadsheet properties and worksheets ONCE
        console.log(`Successfully connected to spreadsheet: "${doc.title}"`);
    } catch (error) {
        console.error("FATAL: Could not connect to Google Sheets.", error.message);
        process.exit(1); // Stop the bot if it can't connect to its database
    }
}

/**
 * Retrieves a worksheet by its title. Creates it if it doesn't exist.
 * @param {string} title The title of the worksheet to find or create.
 * @param {string[]} headers An array of strings for the header row if creating the sheet.
 * @returns {Promise<import('google-spreadsheet').GoogleSpreadsheetWorksheet>}
 */
async function getSheetByName(title, headers) {
    let sheet = doc.sheetsByTitle[title];
    if (!sheet) {
        console.log(`Worksheet "${title}" not found, creating...`);
        sheet = await doc.addSheet({ title, headerValues: headers });
    }
    return sheet; // Returns the sheet object directly
}

// =================================================================================
// ====================== PART 3 of 6: Telegram API Wrappers =======================
// =================================================================================

/**
 * Sends a raw request to the Telegram Bot API.
 * @param {string} endpoint The Telegram API endpoint (e.g., 'sendMessage').
 * @param {object} payload The data to send in the request body.
 * @returns {Promise<object|null>} The result from the Telegram API or null on error.
 */
async function apiRequest(endpoint, payload) {
    try {
        const response = await axios.post(`${TELEGRAM_API_URL}/${endpoint}`, payload);
        return response.data.result;
    } catch (error) {
        console.error(`Telegram API Error (${endpoint}):`, error.response ? error.response.data : error.message);
        return null;
    }
}

// Convenience functions that use the generic apiRequest
async function sendText(chat_id, text, options = {}) { return apiRequest('sendMessage', { chat_id: String(chat_id), text, parse_mode: 'Markdown', ...options }); }
async function editMessageText(chat_id, message_id, text, options = {}) { return apiRequest('editMessageText', { chat_id: String(chat_id), message_id, text, parse_mode: 'Markdown', ...options }); }
async function deleteMessage(chat_id, message_id) { if (!message_id) return; return apiRequest('deleteMessage', { chat_id: String(chat_id), message_id }); }
async function sendChatAction(chat_id, action = 'typing') { return apiRequest('sendChatAction', { chat_id: String(chat_id), action }); }

// =================================================================================
// ============== PART 4 of 6: Core Business Logic and Data Processing =============
// =================================================================================

function getUserState(userId) { const data = props.getProperty('userStates'); return data ? (JSON.parse(data)[userId] || null) : null; }
function setUserState(userId, state) { const data = props.getProperty('userStates') || '{}'; const states = JSON.parse(data); states[userId] = state; props.setProperty('userStates', JSON.stringify(states)); }
function clearUserState(userId) { const data = props.getProperty('userStates'); if (!data) return; const states = JSON.parse(data); delete states[userId]; props.setProperty('userStates', JSON.stringify(states)); }

/**
 * Retrieves a map of all users from the '_users' sheet.
 * This function uses an in-memory cache to avoid fetching from the sheet on every single request.
 * @returns {Promise<{byId: object, byUsername: object}>}
 */
async function getUsers() {
    const CACHE_KEY = 'user_map';
    const cached = cache.getProperty(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    console.log("CACHE MISS: Fetching all users from Google Sheet...");
    const sheet = await getSheetByName(USERS_SHEET_TITLE, USERS_SHEET_HEADERS);
    const rows = await sheet.getRows();

    const userMap = { byId: {}, byUsername: {} };
    rows.forEach(row => {
        if (row.UserID && row.Username) {
            const id = row.UserID.toString();
            const username = row.Username;
            userMap.byId[id] = username;
            userMap.byUsername[username.toLowerCase().replace('@', '')] = id;
        }
    });
    cache.setProperty(CACHE_KEY, JSON.stringify(userMap));
    return userMap;
}

// These functions read from the in-memory cache for speed.
function findUsernameById(userId) { const userMap = JSON.parse(cache.getProperty('user_map') || '{}'); return userMap.byId?.[String(userId)] || null; }
function findUserIdByUsername(username) { const userMap = JSON.parse(cache.getProperty('user_map') || '{}'); return userMap.byUsername?.[username.toLowerCase().replace('@', '')] || null; }

/**
 * Adds a new user to the database or updates their username if it has changed.
 * @param {string|number} userId The user's Telegram ID.
 * @param {string} username The user's current Telegram username.
 */
async function recordUser(userId, username) {
    try {
        const users = await getUsers();
        const userIdStr = userId.toString();
        const currentUsername = users.byId[userIdStr];

        if (!currentUsername) {
            console.log(`NEW USER: Recording ${username} (ID: ${userIdStr})`);
            const sheet = await getSheetByName(USERS_SHEET_TITLE, USERS_SHEET_HEADERS);
            await sheet.addRow({ UserID: userIdStr, Username: username });
            cache.removeProperty('user_map'); // Invalidate cache so it refreshes
        } else if (currentUsername !== username) {
            console.log(`USERNAME UPDATE: ID ${userIdStr} changed from ${currentUsername} to ${username}`);
            const sheet = await getSheetByName(USERS_SHEET_TITLE, USERS_SHEET_HEADERS);
            const rows = await sheet.getRows();
            const rowToUpdate = rows.find(row => row.UserID === userIdStr);
            if (rowToUpdate) {
                rowToUpdate.Username = username;
                await rowToUpdate.save();
                cache.removeProperty('user_map'); // Invalidate cache
            }
        }
    } catch (error) { console.error(`Error in recordUser for ${username}:`, error); }
}

/**
 * Fetches all codes submitted by a user to check for duplicates.
 * @param {string|number} userId The user's Telegram ID.
 * @returns {Promise<Set<string>>} A Set containing all code strings.
 */
async function getAllUserCodes(userId) {
    const username = findUsernameById(userId);
    if (!username) return new Set();
    const sheet = await getSheetByName(username, USER_SHEET_HEADERS);
    if (!sheet) return new Set();
    const rows = await sheet.getRows();
    const codeSet = new Set();
    rows.forEach(row => { if (row.Code) codeSet.add(row.Code); });
    return codeSet;
}

// =================================================================================
// ================ PART 5 of 6: User-Facing Command Handlers ======================
// =================================================================================

/**
 * Handles the /start command.
 */
async function handleStartCommand(chatId, userId) {
    const username = findUsernameById(userId) || `User ${userId}`;
    const keyboard = {
        keyboard: VALID_CODE_TYPES.map(type => [{ text: type }]),
        resize_keyboard: true,
        one_time_keyboard: true,
        input_field_placeholder: "Select a code type to submit"
    };
    await sendText(chatId, `👋 *Welcome, ${username}!* \n\nSelect a code type from the menu below, or just send me your codes.`, { reply_markup: keyboard });
}

/**
 * Handles the /balance command.
 */
async function handleBalanceCommand(chatId, userId) {
    await sendChatAction(chatId, 'typing');
    const loadingMessage = await sendText(chatId, "⏳ Calculating your balance from the database...");

    try {
        const sheet = await getSheetByName(PAYMENTS_LOG_SHEET_TITLE, PAYMENTS_LOG_HEADERS);
        const paymentsRows = await sheet.getRows();
        const totalPaid = paymentsRows
            .filter(row => row.UserID === String(userId))
            .reduce((sum, row) => sum + (parseFloat(row.Amount) || 0), 0);

        const username = findUsernameById(userId);
        const userSheet = await getSheetByName(username, USER_SHEET_HEADERS);
        let totalOwed = 0;
        let unpricedCount = 0;
        if (userSheet) {
            const userRows = await userSheet.getRows();
            for (const row of userRows) {
                if (row.Status && row.Status.toLowerCase() !== 'paid') {
                    const price = parseFloat(row.Price);
                    if (!isNaN(price) && price > 0) {
                        totalOwed += price;
                    } else {
                        unpricedCount++;
                    }
                }
            }
        }

        const netBalance = totalOwed - totalPaid;
        let message = `💰 *Your Withdrawable Balance:* \`$${netBalance.toFixed(2)}\`\n\n`;
        if (unpricedCount > 0) {
            message += `*Note:* You also have ${unpricedCount} unpriced code(s) not included in this total.`;
        }
        await editMessageText(chatId, loadingMessage.message_id, message);

    } catch (error) {
        console.error(`Error in handleBalanceCommand for user ${userId}:`, error);
        await editMessageText(chatId, loadingMessage.message_id, "❌ An error occurred while fetching your balance.");
    }
}

/**
 * Handles a user's submission of codes.
 */
async function handleCodeSubmission(chatId, text, userId, userState) {
    const loadingMessage = await sendText(chatId, "⏳ Validating codes and saving to the database...");

    const submittedCodes = text.split('\n').map(l => l.trim()).filter(Boolean);
    const validFormatCodes = new Set(submittedCodes.filter(code => CODE_PATTERN_REGEX.test(code)));

    if (validFormatCodes.size === 0) {
        await editMessageText(chatId, loadingMessage.message_id, "❌ Submission Failed: None of the codes had a valid format.");
        return;
    }

    try {
        const existingCodes = await getAllUserCodes(userId);
        const uniqueNewCodes = [...validFormatCodes].filter(code => !existingCodes.has(code));

        if (uniqueNewCodes.length > 0) {
            const username = findUsernameById(userId);
            const sheet = await getSheetByName(username, USER_SHEET_HEADERS);
            if (!sheet) throw new Error("Could not find or create user sheet.");

            const batchId = new Date().getTime();
            const newRows = uniqueNewCodes.map(code => ({
                "Code": code, "Type": userState.type, "Timestamp": new Date().toISOString(),
                "Price": "", "Batch ID": batchId, "Status": "Pending", "Note": ""
            }));

            await sheet.addRows(newRows);
            let userMessage = `🎉 *Submission Complete!*\n\n✅ Accepted: *${uniqueNewCodes.length}* new '${userState.type}' code(s).`;
            await editMessageText(chatId, loadingMessage.message_id, userMessage);
        } else {
            await editMessageText(chatId, loadingMessage.message_id, "ℹ️ All codes you sent were duplicates of previous submissions and have been ignored.");
        }
    } catch (error) {
        console.error(`Error during code submission for user ${userId}:`, error);
        await editMessageText(chatId, loadingMessage.message_id, "❌ A database error occurred. Please contact an admin.");
    } finally {
        clearUserState(userId);
    }
}

// =================================================================================
// =================== PART 6 of 6: Main Webhook Handler and Server ================
// =================================================================================

/**
 * The main webhook handler. This function is the entry point for all updates from Telegram.
 * It routes incoming messages and callbacks to the appropriate handler functions.
 */
async function handleWebhookRequest(req, res) {
    // Respond immediately to Telegram with a 200 OK to prevent timeouts and retries.
    res.status(200).send('OK');

    const contents = req.body;

    try {
        if (contents.message) {
            const msg = contents.message;
            const { from, chat, text } = msg;

            // Ignore messages without text, a sender, or a chat.
            if (!text || !from || !chat) return;

            const fromUsername = `@${from.username || from.id}`;
            // Ensure the user is in our database on every interaction.
            await recordUser(from.id, fromUsername);

            const state = getUserState(from.id);

            // If the user is in the middle of submitting codes, route the message there.
            if (state && state.action === 'submitting') {
                await handleCodeSubmission(chat.id, text, from.id, state);
                return;
            }

            // Route based on message content
            if (text.startsWith('/')) {
                const [command] = text.split(' ');
                if (command === '/start') await handleStartCommand(chat.id, from.id);
                else if (command === '/balance') await handleBalanceCommand(chat.id, from.id);
                else await sendText(chat.id, "🤔 Unrecognized command. Try /start or /help.");
            } else if (VALID_CODE_TYPES.includes(text)) {
                // If the user sends a valid code type, set their state to 'submitting'.
                setUserState(from.id, { action: 'submitting', type: text });
                await sendText(chat.id, `✅ *Selected: ${text}*\n\nNow, please send me the codes for this type. Each code should be on a new line.`);
            } else {
                // Handle any other text message.
                await sendText(chat.id, "I'm not sure what you mean. Please select a code type from the menu, or use a command like /start.");
            }
        } else if (contents.callback_query) {
            // This is where you would handle button clicks (callbacks).
            console.log("Received a callback query:", contents.callback_query.data);
            // Example: await handleCallbackQuery(contents.callback_query);
        }
    } catch (error) {
        console.error("CRITICAL ERROR in Webhook Handler:", error);
        // Notify the admin of a critical failure.
        const adminId = findUserIdByUsername(adminUsername);
        if (adminId) {
            await sendText(adminId, `⚠️ A critical error occurred in the bot: \n\n\`${error.message}\``);
        }
    }
}

// =================================================================================
// ===== EXPRESS SERVER SETUP ======================================================
// =================================================================================

const app = express();
app.use(bodyParser.json()); // Use middleware to parse JSON bodies

// Set the main webhook handler for the /webhook route
app.post('/webhook', handleWebhookRequest);

// A simple root route to confirm the server is running
app.get('/', (req, res) => {
    res.send('Telegram Bot server is running and connected to Google Sheets.');
});

const PORT = process.env.PORT || 3000;

// This is the main startup sequence.
console.log("Initializing bot...");
initializeAuth()
    .then(() => {
        console.log("Warming up user cache...");
        return getUsers(); // Pre-load the user list into the cache
    })
    .then(() => {
        app.listen(PORT, () => {
            console.log(`✅ Bot is online. Server listening on port ${PORT}`);
            console.log("Ready to receive updates from Telegram.");
        });
    })
    .catch(err => {
        console.error("Failed to start the bot:", err);
    });
