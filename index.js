// =================================================================================
// ===== CONFIGURATION (Node.js Environment) =======================================
// =================================================================================
const telegramToken = '8012735434:AAFuPm2Wni1SEZsrka9UMF7D5j1Xba3bbm0';
const adminUsername = '@Oukira';
const specialUserUsernames = ['@Faiyaz_ali777', '@sayed_kira'];

const MINIMUM_PAYOUT_AMOUNT = 50.00;

// Code types visible to all users
const CODE_TYPES_ALL_USERS = ['1000 Roblox', '800 Roblox', '400 Roblox', 'lol 575', 'ow 1k'];

// Code types only visible to special users
const CODE_TYPES_SPECIAL_USERS = [
    'minecoin 330', 'lol 575', 'pc game pass', 'lol 100', 'ow 200',
];

const SHEET_HEADERS = ["Code", "Type", "Timestamp", "Price", "Batch ID", "Status", "Note"];
const VALID_CODE_TYPES = [
    "1000 Roblox", "800 Roblox", "400 Roblox", "ow 1k", "ow 200",
    "minecoin 330", "lol 575", "pc game pass", "lol 100",
];
const CODE_PATTERN_REGEX = /^[a-zA-Z0-9-]{5,}$/;
const TELEGRAM_API_URL = "https://api.telegram.org/bot" + telegramToken;

// --- Node.js Imports and Dependencies ---
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

// =================================================================================
// ===== GOOGLE SHEETS SETUP =======================================================
// =================================================================================

// Google Sheets authentication
const auth = new google.auth.GoogleAuth({
  keyFile: 'service-account-key.json', // You need to create this file
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Main spreadsheet ID - create a Google Sheet and put its ID here
const MAIN_SPREADSHEET_ID = '1sd7X14srLY_0iIYU-rigie9MZOWV2Feu2R8bg0qtv3c';

// Real Google Sheets implementation
class RealGoogleSheet {
    constructor(sheetName) {
        this.sheetName = sheetName;
        this.spreadsheetId = MAIN_SPREADSHEET_ID;
    }

    async ensureSheetExists() {
        try {
            // Try to access the sheet to see if it exists
            await sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A1`,
            });
            return true;
        } catch (error) {
            // Sheet doesn't exist, create it
            if (error.code === 400) {
                await this.createSheet();
                await this.initializeHeaders();
                return true;
            }
            console.error('Error ensuring sheet exists:', error);
            return false;
        }
    }

    async createSheet() {
        try {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: this.sheetName
                            }
                        }
                    }]
                }
            });
            console.log(`✅ Created new sheet: ${this.sheetName}`);
        } catch (error) {
            console.error('❌ Error creating sheet:', error);
            throw error;
        }
    }

    async initializeHeaders() {
        try {
            await sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A1:G1`,
                valueInputOption: 'RAW',
                resource: {
                    values: [SHEET_HEADERS]
                }
            });
            console.log(`✅ Initialized headers for sheet: ${this.sheetName}`);
        } catch (error) {
            console.error('❌ Error initializing headers:', error);
            throw error;
        }
    }

    async getLastRow() {
        try {
            await this.ensureSheetExists();
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A:A`,
            });
            
            if (!response.data.values) return 1; // Only headers exist
            return response.data.values.length;
        } catch (error) {
            console.error('Error getting last row:', error);
            return 1;
        }
    }

    async appendRow(rowData) {
        try {
            await this.ensureSheetExists();
            
            const response = await sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A:G`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    values: [rowData]
                }
            });
            
            console.log(`✅ Appended row to ${this.sheetName}: ${rowData[0]}`);
            return response.data;
        } catch (error) {
            console.error('❌ Error appending row:', error);
            throw error;
        }
    }

    async getRange(row, col, numRows = 1, numCols = SHEET_HEADERS.length) {
        try {
            await this.ensureSheetExists();
            
            const startCol = String.fromCharCode(64 + col);
            const endCol = String.fromCharCode(64 + col + numCols - 1);
            
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!${startCol}${row}:${endCol}${row + numRows - 1}`,
            });

            const values = response.data.values || [];

            return {
                getValues: () => values,
                setValues: async (newValues) => {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: this.spreadsheetId,
                        range: `${this.sheetName}!${startCol}${row}:${endCol}${row + numRows - 1}`,
                        valueInputOption: 'RAW',
                        resource: { values: newValues }
                    });
                },
                clearContent: async () => {
                    await sheets.spreadsheets.values.clear({
                        spreadsheetId: this.spreadsheetId,
                        range: `${this.sheetName}!${startCol}${row}:${endCol}${row + numRows - 1}`,
                    });
                }
            };
        } catch (error) {
            console.error('Error getting range:', error);
            throw error;
        }
    }

    async getDataRange() {
        const lastRow = await this.getLastRow();
        return this.getRange(1, 1, lastRow, SHEET_HEADERS.length);
    }

    getLastColumn() {
        return SHEET_HEADERS.length;
    }

    async clearContents() {
        try {
            await sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A2:Z`, // Clear all data except headers
            });
        } catch (error) {
            console.error('Error clearing contents:', error);
        }
    }

    getSheetId() {
        return this.sheetName;
    }
}

// =================================================================================
// ===== REPLACE MOCK STORAGE WITH REAL STORAGE ====================================
// =================================================================================

// Simple in-memory storage for script properties and cache.
class SimpleStore {
    constructor() {
        this.store = {};
    }
    setProperty(key, value) { this.store[key] = value; }
    getProperty(key) { return this.store[key]; }
    removeProperty(key) { delete this.store[key]; }
    removeAll(keys) { keys.forEach(key => delete this.store[key]); }
}

const props = new SimpleStore();
const cache = new SimpleStore();

// Mock for Google Apps Script's Logger
const Logger = {
    log: (message) => {
        console.log(`[LOG] ${message}`);
    }
}

// Mock for Google Apps Script's LockService
const LockService = {
    getScriptLock: () => ({
        waitLock: (timeout) => { /* Mocking wait lock */ },
        releaseLock: () => { /* Mocking release lock */ }
    })
}

// Initialize real Google Sheets
const userSheets = {
    '_users': new RealGoogleSheet('_users'),
    '_payments_log': new RealGoogleSheet('_payments_log'),
    '_payout_ledger': new RealGoogleSheet('_payout_ledger'),
    '_master_log': new RealGoogleSheet('_master_log'),
};

// Initialize system sheets with headers
async function initializeSystemSheets() {
    try {
        console.log('🔄 Initializing system sheets...');
        
        // Initialize users sheet
        const usersLastRow = await userSheets['_users'].getLastRow();
        if (usersLastRow === 1) {
            await userSheets['_users'].appendRow(["UserID", "Username"]);
        }
        
        // Initialize payments log
        const paymentsLastRow = await userSheets['_payments_log'].getLastRow();
        if (paymentsLastRow === 1) {
            await userSheets['_payments_log'].appendRow(["TransactionID", "Timestamp", "UserID", "Username", "Amount", "Admin", "Note"]);
        }
        
        // Initialize payout ledger
        const payoutLastRow = await userSheets['_payout_ledger'].getLastRow();
        if (payoutLastRow === 1) {
            await userSheets['_payout_ledger'].appendRow(["TransactionID", "Timestamp", "UserID", "Username", "Amount Paid", "Admin"]);
        }
        
        // Initialize master log
        const masterLastRow = await userSheets['_master_log'].getLastRow();
        if (masterLastRow === 1) {
            await userSheets['_master_log'].appendRow(["UserID", "Username", "Code", "Type", "Timestamp", "Price", "Batch ID", "Status", "Note"]);
        }
        
        console.log('✅ System sheets initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing system sheets:', error);
    }
}

// FIX: Consolidated Sheet Creation Logic for new users
function getSheetByName(name) {
    if (!userSheets[name]) {
        if (!name.startsWith('_')) {
            userSheets[name] = new RealGoogleSheet(name);
            console.log(`📄 Created new RealGoogleSheet for: ${name}`);
        } else {
            return null;
        }
    }
    return userSheets[name];
}

// Mock for a Utility function
const Utilities = {
    formatDate: (date, timeZone, format) => {
        const d = new Date(date);
        return d.toISOString().split('T')[0]; // YYYY-MM-DD format
    },
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    newBlob: (content, type, name) => ({ content, type, name }),
}

// =================================================================================
// ===== TELEGRAM API WRAPPERS =====================================================
// =================================================================================

async function apiRequest(method, payload) {
    const url = `${TELEGRAM_API_URL}/${method}`;
    try {
        const response = await axios.post(url, payload, { validateStatus: null });
        const resData = response.data;
        if (resData.ok) {
            return resData.result;
        }
        console.log(`API Error (${method}): ${JSON.stringify(resData)}`);
        return null;
    } catch(e) {
        console.log(`API Exception (${method}): ${e.message}`);
        return null;
    }
}

async function sendText(chat_id, text, options = {}) { 
    return apiRequest('sendMessage', { chat_id: String(chat_id), text, parse_mode: 'Markdown', ...options }); 
}

async function editMessageText(chat_id, message_id, text, options = {}) { 
    return apiRequest('editMessageText', { chat_id: String(chat_id), message_id, text, parse_mode: 'Markdown', ...options }); 
}

async function deleteMessage(chat_id, message_id) { 
    if (!message_id) return; 
    return apiRequest('deleteMessage', { chat_id: String(chat_id), message_id }); 
}

async function sendDocument(chat_id, document, caption = '') {
    // Note: Proper file upload requires 'form-data' in Node.js
    return sendText(chat_id, `[MOCK] Document ${document.name} sent with caption: ${caption}`);
}

async function answerCallbackQuery(callback_query_id) { 
    return apiRequest('answerCallbackQuery', { callback_query_id }); 
}

async function sendChatAction(chat_id, action = 'typing') { 
    return apiRequest('sendChatAction', { chat_id: String(chat_id), action }); 
}

// =================================================================================
// ===== HELPER & UTILITY FUNCTIONS ================================================
// =================================================================================

function getPaymentsLogSheet() {
    return { sheet: getSheetByName('_payments_log') };
}

function getPayoutLedgerSheet() {
    return { sheet: getSheetByName('_payout_ledger') };
}

function getMasterSheet() {
    return { sheet: getSheetByName('_master_log') };
}

function getUsersSheet() { 
    return { sheet: getSheetByName('_users') }; 
}

async function getSheetHeaders(sheet) {
    if (!sheet) return {};
    try {
        const headersRange = await sheet.getRange(1, 1, 1, sheet.getLastColumn());
        const headers = headersRange.getValues()[0];
        const headerMap = {};
        headers.forEach((header, i) => { 
            headerMap[header.toString().toLowerCase().trim()] = i + 1; 
        });
        return headerMap;
    } catch (error) {
        console.error('Error getting sheet headers:', error);
        return {};
    }
}

async function getUsers() {
    const CACHE_KEY = 'user_map';
    let cached = cache.getProperty(CACHE_KEY);
    if (cached) return JSON.parse(cached);
    
    const { sheet } = getUsersSheet();
    const lastRow = await sheet.getLastRow();
    if (lastRow < 2) return { byId: {}, byUsername: {} };
    
    const dataRange = await sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
    const data = dataRange.getValues();
    const userMap = { byId: {}, byUsername: {} };
    
    data.forEach(row => {
        if (row[0] && row[1]) {
            const id = row[0].toString();
            const username = row[1].toString();
            userMap.byId[id] = username;
            userMap.byUsername[username.toLowerCase().replace('@', '')] = id;
        }
    });
    
    cache.setProperty(CACHE_KEY, JSON.stringify(userMap));
    return userMap;
}

async function findUsernameById(userId) { 
    const users = await getUsers();
    return users.byId[String(userId)] || null; 
}

async function findUserIdByUsername(username) { 
    const users = await getUsers();
    return users.byUsername[username.toLowerCase().replace('@', '')] || null; 
}

async function getAdminChatId(forceLookup = false) {
    if(!forceLookup) {
        const adminIdFromCache = props.getProperty('adminChatId');
        if(adminIdFromCache) return adminIdFromCache;
    }
    const adminId = await findUserIdByUsername(adminUsername);
    if (adminId) props.setProperty('adminChatId', adminId);
    return adminId;
}

// FIX: Simplified to rely solely on getSheetByName for creation/retrieval
async function getSheetByUserId(userId) {
    const username = await findUsernameById(userId);
    if (!username) { return { sheet: null, headers: null }; }
    let sheet = getSheetByName(username);
    if (!sheet) { return { sheet: null, headers: null }; }
    const headers = await getSheetHeaders(sheet);
    return { sheet, headers };
}

function invalidateUserStatCaches(userId) {
    const keys = [
      `profile_stats_${userId}`, `mystats_stats_${userId}`,
      `pending_codes_${userId}`, `user_codes_${userId}`, `payments_${userId}`,
      'market_demand_data', 'enhanced_market_data', 'user_map',
      'all_codes_cache'
    ];
    keys.forEach(key => cache.removeProperty(key));
}

async function recordUser(userId, username) {
    const users = await getUsers();
    const currentUsername = users.byId[userId.toString()];
    if (!currentUsername) {
      const { sheet: usersSheet } = getUsersSheet();
      await usersSheet.appendRow([userId, username]);
      cache.removeProperty('user_map');
    } else if (currentUsername !== username) {
      const { sheet: usersSheet } = getUsersSheet();
      const lastRow = await usersSheet.getLastRow();
      const dataRange = await usersSheet.getRange(1, 1, lastRow, usersSheet.getLastColumn());
      const data = dataRange.getValues();
      
      for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === userId.toString()) {
          data[i][1] = username;
          await usersSheet.getRange(i + 1, 2, 1, 1).setValues([[username]]);
          cache.removeProperty('user_map');
          break;
        }
      }
    }
}

function getUserState(userId) { 
    const data = props.getProperty('userStates'); 
    return data ? (JSON.parse(data)[userId] || null) : null; 
}

function setUserState(userId, state) { 
    const data = props.getProperty('userStates') || '{}'; 
    const states = JSON.parse(data); 
    states[userId] = state; 
    props.setProperty('userStates', JSON.stringify(states)); 
}

function clearUserState(userId) { 
    const data = props.getProperty('userStates'); 
    if (!data) return; 
    const states = JSON.parse(data); 
    delete states[userId]; 
    props.setProperty('userStates', JSON.stringify(states)); 
}

async function getTotalPaidForUser(userId) {
    const cacheKey = `payments_${userId}`;
    const cached = cache.getProperty(cacheKey);
    if (cached) return parseFloat(cached);
    
    const sheet = getPaymentsLogSheet().sheet;
    const lastRow = await sheet.getLastRow();
    if (lastRow < 2) return 0;
    
    const dataRange = await sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
    const data = dataRange.getValues();
    let total = 0;
    const userIdString = String(userId);
    
    for (const row of data) {
        if (String(row[2]) === userIdString) {
            total += parseFloat(row[4]) || 0;
        }
    }
    
    cache.setProperty(cacheKey, String(total));
    return total;
}

async function logPayoutTransaction(userId, username, amount, adminUsername) {
    const sheet = getPayoutLedgerSheet().sheet;
    const timestamp = new Date().toISOString();
    const transactionId = `PAY-${timestamp.replace(/[^0-9]/g, '')}`;
    await sheet.appendRow([transactionId, timestamp, userId, username, amount.toFixed(2), adminUsername]);
}

function deleteUserDataSheet(userId) {
    // Note: In real implementation, you might want to archive instead of delete
    const username = findUsernameById(userId);
    if (username) {
      delete userSheets[username]; 
    }
    invalidateUserStatCaches(userId);
}

async function getAllUserCodes(userId) {
    const cacheKey = `user_codes_${userId}`;
    const cached = cache.getProperty(cacheKey);
    if (cached) return new Set(JSON.parse(cached));
    
    const { sheet, headers } = await getSheetByUserId(userId);
    const codeSet = new Set();
    if (!sheet) return codeSet;
    
    const lastRow = await sheet.getLastRow();
    if (lastRow < 2) return codeSet;
    
    const codeCol = headers['code'];
    if (!codeCol) return codeSet;
    
    const codeValuesRange = await sheet.getRange(2, codeCol, lastRow - 1, 1);
    const codeValues = codeValuesRange.getValues();
    
    codeValues.forEach(row => { 
        if (row[0]) codeSet.add(row[0].toString()); 
    });
    
    cache.setProperty(cacheKey, JSON.stringify(Array.from(codeSet)));
    return codeSet;
}

async function getAllUserSheets() {
    const allUsers = await getUsers();
    const userSheetsData = {};
    
    for (const userId in allUsers.byId) {
        const username = allUsers.byId[userId];
        const sheet = getSheetByName(username);
        if (sheet) {
            const headers = await getSheetHeaders(sheet);
            userSheetsData[userId] = {
                sheet: sheet,
                headers: headers
            };
        }
    }
    return userSheetsData;
}

// =================================================================================
// ===== CORE BOT LOGIC ============================================================
// =================================================================================

async function handleCommand(text, from, chat, isAdmin) {
    const [command, ...args] = text.split(' ');
    const userId = from.id;
    const chatId = chat.id;

    const userCommands = {
        '/start': () => handleStartCommand(chatId, userId),
        '/balance': () => handleBalanceCommand(chatId, userId),
        '/withdraw': () => handleWithdrawCommand(chatId, userId),
        '/profile': () => handleProfileCommand(chatId, userId, args),
        '/market': () => handleMarketCommand(chatId),
        '/help': () => sendHelpMessage(chatId, isAdmin),
        '/mydata': () => handleMyDataCommand(chatId, userId),
        '/mybatches': () => handleMyBatchesCommand(chatId, userId),
        '/reset': async () => {
            const keyboard = { inline_keyboard: [[{ text: "⚠️ Proceed with Data Deletion", callback_data: 'resetdata' }]] };
            await sendText(chatId, "This command will permanently erase all your data. Press below to confirm.", { reply_markup: keyboard });
        },
        '/cancel': async () => {
            clearUserState(userId);
            await sendText(chatId, "✅ Action cancelled. You can now enter a new command.");
        }
    };

    const adminCommands = {
        ...userCommands,
        '/manage_market': () => handleManageMarketCommand(chatId),
        '/log_payment': () => handleLogPaymentCommand(chatId, from.username, args),
        '/scan': () => handleScanCommand(chatId),
        '/process': () => {
            if (args.length > 0 && args[0].startsWith('@')) {
                return startUserProcessingQueue(chatId, args[0]);
            } else {
                return startProcessingQueue(chatId);
            }
        },
        '/unpriced': () => handleUnpricedCommand(chatId, args),
        '/summary': () => handleSummaryCommand(chatId, args),
        '/summaryall': () => handleSummaryAllCommand(chatId),
        '/message': () => handleMessageCommand(from.id, args),
        '/search': () => handleSearchCommand(chatId, args),
        '/refresh': () => handleRefreshCommand(chatId),
        '/broadcast': async () => {
            setUserState(userId, { action: 'awaiting_broadcast' });
            await sendText(chatId, "📣 *Broadcast Mode*\n\nPlease send the message you want to broadcast to all users.");
        },
        '/count': () => handleCountCommand(chatId),
        '/setreminder': async () => Logger.log('Trigger mock: createDailyReminderTrigger'),
        '/setupmarket': async () => Logger.log('Trigger mock: createMarketUpdateTrigger'),
        '/updatemarket': () => updateAllMarketMessages(),
        '/endchat': async () => {}
    };

    const commands = isAdmin ? adminCommands : userCommands;
    if (commands[command]) {
        await commands[command]();
    } else {
        await sendText(chatId, "🤔 Unrecognized command. Try /help.");
    }
}

async function sendHelpMessage(chatId, isAdmin) {
    let message = `🤖 *Bot Help*\n\n`;
    message += `*User Commands:*\n`;
    message += `▫️ /start - Start the bot\n`;
    message += `▫️ /balance - Check your balance\n`;
    message += `▫️ /withdraw - Request withdrawal\n`;
    message += `▫️ /profile - View your profile\n`;
    message += `▫️ /market - View market data\n`;
    message += `▫️ /mydata - Export your data\n`;
    message += `▫️ /mybatches - View your batches\n`;
    message += `▫️ /reset - Delete your data\n`;
    message += `▫️ /cancel - Cancel current action\n`;
    
    if (isAdmin) {
        message += `\n*Admin Commands:*\n`;
        message += `▫️ /manage_market - Manage market prices\n`;
        message += `▫️ /log_payment - Log a payment\n`;
        message += `▫️ /scan - Scan all user data\n`;
        message += `▫️ /process - Process unpriced codes\n`;
        message += `▫️ /summary @user - User summary\n`;
        message += `▫️ /summaryall - All users summary\n`;
        message += `▫️ /message @user - Send message\n`;
        message += `▫️ /search code - Search codes\n`;
        message += `▫️ /broadcast - Broadcast message\n`;
        message += `▫️ /count - System stats\n`;
    }
    
    await sendText(chatId, message);
}

async function handleStartCommand(chatId, userId, fromCallback = false) {
    if (!fromCallback) {
        await sendText(chatId, `👋 *Welcome!*\n\nTo begin, please select a code type from the menu below.`);
    }
    
    const username = await findUsernameById(userId);
    const isAdmin = username === adminUsername;
    const isSpecialUser = specialUserUsernames.includes(username);

    const allowedCodeTypes = (isSpecialUser || isAdmin) ?
        [...CODE_TYPES_ALL_USERS, ...CODE_TYPES_SPECIAL_USERS] :
        CODE_TYPES_ALL_USERS;

    const keyboard = {
        keyboard: allowedCodeTypes.map(type => [type]),
        resize_keyboard: true, 
        one_time_keyboard: true, 
        input_field_placeholder: "Select a code type to submit"
    };
    
    const sentMessage = await sendText(chatId, "👇 Please select an item to submit.", { reply_markup: keyboard });
    if (sentMessage) {
        setUserState(userId, { action: 'awaiting_code_type', messageIdsToDelete: [sentMessage.message_id] });
    }
}

async function handleCodeSubmission(chatId, text, userId, userState) {
    const loadingMessage = await sendText(chatId, "⏳ Validating and processing your codes...");
    
    const submissionUserId = userId;
    const submissionUsername = await findUsernameById(userId);

    const allSubmittedCodes = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (allSubmittedCodes.length === 0) {
        await editMessageText(chatId, loadingMessage.message_id, "❌ *No Codes Found*\n\nPlease send at least one code.");
        return;
    }

    const validFormatCodes = new Set();
    const invalidFormatCodes = new Set();
    allSubmittedCodes.forEach(code => { 
        CODE_PATTERN_REGEX.test(code) ? validFormatCodes.add(code) : invalidFormatCodes.add(code); 
    });

    if (validFormatCodes.size === 0) {
        let userMessage = `❌ *Submission Failed*\n\nNone of the ${allSubmittedCodes.length} code(s) you sent had a valid format.\n\n⚠️ *Rejected Codes:*\n\`\`\`\n${[...invalidFormatCodes].join('\n')}\n\`\`\``;
        await editMessageText(chatId, loadingMessage.message_id, userMessage);
        clearUserState(userId);
        return;
    }

    const { sheet } = await getSheetByUserId(submissionUserId);
    if (!sheet) {
      await editMessageText(chatId, loadingMessage.message_id, "❌ *Error*\nCould not find or create your data sheet. Please contact an admin.");
      return;
    }
    
    const existingCodes = await getAllUserCodes(submissionUserId);

    const uniqueNewCodes = [];
    const duplicateCodes = [];
    validFormatCodes.forEach(code => { 
        existingCodes.has(code) ? duplicateCodes.push(code) : uniqueNewCodes.push(code); 
    });

    if (uniqueNewCodes.length > 0) {
        const formattedTimestamp = Utilities.formatDate(new Date(), 'UTC', "MM/dd/yyyy");
        const batchId = new Date().getTime();

        // Append each code individually
        for (const code of uniqueNewCodes) {
            const newRow = [code, userState.type, formattedTimestamp, "", batchId, "Pending", ""];
            await sheet.appendRow(newRow);
        }
        
        invalidateUserStatCaches(submissionUserId);

        const isAdminSubmitter = submissionUsername === adminUsername;
        const isSpecialSubmitter = specialUserUsernames.includes(submissionUsername);

        let notificationMessage = `📥 *New Submission from \`${submissionUsername}\`*\n\n`;
        notificationMessage += `▫️ *Type:* \`${userState.type}\`\n`;
        notificationMessage += `▫️ *New Codes:* \`${uniqueNewCodes.length}\`\n`;
        notificationMessage += `▫️ *Batch ID:* \`${batchId}\`\n\n`;
        notificationMessage += `*Sample Codes:*\n\`\`\`\n${uniqueNewCodes.slice(0, 5).join('\n')}\n\`\`\``;
        
        if (uniqueNewCodes.length > 5) {
            notificationMessage += `\n*... and ${uniqueNewCodes.length - 5} more codes*`;
        }

        const adminKeyboard = {
            inline_keyboard: [
                [{ text: "✅ Code Listed", callback_data: `listcode_${submissionUserId}_${batchId}` }, { text: "🗑️ Delete", callback_data: `admindelete_${submissionUserId}_${batchId}` }],
                [{ text: "✏️ Add Note", callback_data: `addnote_${submissionUserId}_${batchId}` }]
            ]
        };
        
        const specialUserKeyboard = { 
            inline_keyboard: [[{ text: "✏️ Set Price For My Codes", callback_data: `setprice_${submissionUserId}_${batchId}` }]]
        };

        if (isSpecialSubmitter || isAdminSubmitter) {
          await sendText(submissionUserId, notificationMessage, { reply_markup: specialUserKeyboard });
        }
        
        const adminChatId = await getAdminChatId();
        if (adminChatId && !isAdminSubmitter) {
            await sendText(adminChatId, notificationMessage, { reply_markup: adminKeyboard });
        }
    }
    
    let userMessage = `🎉 *Submission Complete for \`@${submissionUsername}\`!*\n\n`;
    if (uniqueNewCodes.length > 0) userMessage += `✅ Accepted: *${uniqueNewCodes.length}* new '${userState.type}' code(s).\n`;
    if (duplicateCodes.length > 0) userMessage += `🟡 Rejected *${duplicateCodes.length}* as duplicates.\n`;
    if (invalidFormatCodes.size > 0) userMessage += `🔴 Rejected *${invalidFormatCodes.size}* with invalid format.\n`;
    userMessage += "\nWhat would you like to do next?";
    
    const userKeyboard = {
        inline_keyboard: [
            [{ text: `➕ Submit More (${userState.type})`, callback_data: `submitsame_${userState.type}` }, { text: "📝 Submit Different", callback_data: 'submitmore' }],
            [{ text: "💰 Check Balance", callback_data: 'checkbalance' }]
        ]
    };
    
    await editMessageText(chatId, loadingMessage.message_id, userMessage, { reply_markup: userKeyboard });

    if (userState.messageIdsToDelete) {
        for (const msgId of userState.messageIdsToDelete) {
            await deleteMessage(chatId, msgId);
        }
    }
    clearUserState(userId);
}

// =================================================================================
// ===== WEBHOOK HANDLER ===========================================================
// =================================================================================

async function handleWebhookRequest(req, res) {
    const contents = req.body;

    try {
        if (contents.callback_query) {
            await handleCallbackQuery(contents.callback_query);
            return res.status(200).send('OK');
        }

        const msg = contents.message;
        if (!msg || !msg.from || !msg.chat || !msg.text) return res.status(200).send('OK');

        const from = msg.from;
        const chat = msg.chat;
        const text = msg.text.trim();
        const fromUsername = `@${from.username}`;
        const isAdmin = fromUsername === adminUsername;

        if (isAdmin) props.setProperty('adminChatId', from.id.toString());
        await recordUser(from.id, fromUsername);

        if (text.toLowerCase() === '/cancel') {
            clearUserState(from.id);
            await sendText(from.id, "✅ Action cancelled. You can now use other commands.");
            return res.status(200).send('OK');
        }

        const state = getUserState(from.id);

        if (text.startsWith('/')) {
            await handleCommand(text, from, chat, isAdmin);
            return res.status(200).send('OK');
        }

        const userState = getUserState(from.id);
        if (VALID_CODE_TYPES.includes(text)) {
            const isSpecialUser = specialUserUsernames.includes(await findUsernameById(from.id));
            const allowedCodeTypes = (isSpecialUser || isAdmin) ?
                [...CODE_TYPES_ALL_USERS, ...CODE_TYPES_SPECIAL_USERS] :
                CODE_TYPES_ALL_USERS;
            
            if (!allowedCodeTypes.map(t => t.toLowerCase()).includes(text.toLowerCase())) {
              await sendText(chat.id, `❌ You don't have permission to submit ${text} codes.`);
              return res.status(200).send('OK');
            }
            
            const currentState = userState || {};
            const messageIdsToDelete = currentState.messageIdsToDelete || [];
            messageIdsToDelete.push(msg.message_id);
            
            const confirmationMessage = await sendText(chat.id, `✅ *Selected: ${text}*\n\nNow, please send the codes. Each code should be on a new line.`);
            if (confirmationMessage) messageIdsToDelete.push(confirmationMessage.message_id);
            
            let newState = { action: 'submitting', type: text, messageIdsToDelete: messageIdsToDelete };
            setUserState(from.id, newState);
            return res.status(200).send('OK');
        }

        if (userState && userState.action === 'submitting') {
            await handleCodeSubmission(chat.id, text, from.id, userState);
        } else if (!isAdmin) {
            const adminChatId = await getAdminChatId();
            if(adminChatId){
              let message = `*Incoming Message from \`${fromUsername}\`*\n\n${text}`;
              const keyboard = { inline_keyboard: [[{ text: `✍️ Reply to ${fromUsername}`, callback_data: `reply_${from.id}` }]] };
              await sendText(adminChatId, message, { reply_markup: keyboard });
            }
        }

    } catch (error) {
        console.error(`CRITICAL ERROR in handleWebhookRequest: ${error.message}\nStack: ${error.stack}`);
        const adminChatId = await getAdminChatId();
        if (adminChatId) await sendText(adminChatId, `⚠️ Critical Bot Error: ${error.message}`);
    }

    res.status(200).send('OK');
}

// =================================================================================
// ===== EXPRESS SERVER SETUP ======================================================
// =================================================================================

const app = express();
app.use(bodyParser.json());

// Set up the main webhook handler
app.post('/webhook', handleWebhookRequest);

// Simple health check/status endpoint
app.get('/', (req, res) => {
    res.send('Telegram Bot is running. Listening for webhooks on /webhook.');
});

const PORT = process.env.PORT || 3000;

// Initialize and start server
async function startServer() {
    try {
        await initializeSystemSheets();
        app.listen(PORT, () => {
            console.log(`✅ Node.js Telegram Bot server listening on port ${PORT}`);
            console.log(`✅ Using REAL Google Sheets for data storage`);
            console.log(`✅ Main Spreadsheet ID: ${MAIN_SPREADSHEET_ID}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// Note: You need to create a service-account-key.json file with your Google Service Account credentials
// and set the MAIN_SPREADSHEET_ID to your actual Google Sheet ID