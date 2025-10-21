// =================================================================================
// ===== CONFIGURATION (Node.js Environment) =======================================
// =================================================================================
const telegramToken = '8012735434:AAFSTgHOt5AgTg5mi4jFIdCgQN61rMzWfls';
const adminUsername = '@Oukira';
const specialUserUsernames = ['@Faiyaz_ali777', '@sayed_kira'];
const { GoogleSpreadsheet } = require('1sd7X14srLY_0iIYU-rigie9MZOWV2Feu2R8bg0qtv3c');
const creds = require('./credentials.json');
require('dotenv').config();

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
const axios = require('axios'); // Used to replace UrlFetchApp

// =================================================================================
// ===== MOCK GAS SERVICES (REPLACING GOOGLE APPS SCRIPT DEPENDENCIES) =============
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
const cache = new SimpleStore(); // Mocking CacheService

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

class GoogleSheet {
    constructor(sheetId, sheetTitle) {
        this.doc = new GoogleSpreadsheet(sheetId);
        this.sheetTitle = sheetTitle;
        this.sheet = null;
    }

    async init() {
        await this.doc.useServiceAccountAuth(creds);
        await this.doc.loadInfo();
        this.sheet = this.doc.sheetsByTitle[this.sheetTitle];
    }

    async getRows() {
        if (!this.sheet) await this.init();
        return await this.sheet.getRows();
    }

    async addRow(rowData) {
        if (!this.sheet) await this.init();
        return await this.sheet.addRow(rowData);
    }

    async getHeaderRow() {
        if (!this.sheet) await this.init();
        return this.sheet.headerValues;
    }

    async clear() {
        if (!this.sheet) await this.init();
        await this.sheet.clear();
    }

    async setHeaderRow(headerValues) {
        if (!this.sheet) await this.init();
        await this.sheet.setHeaderRow(headerValues);
    }
}
// In-memory representation of sheets for users
const userSheets = {
    '_users': new InMemorySheet('_users', ['UserID', 'Username']),
    '_payments_log': new InMemorySheet('_payments_log', ["TransactionID", "Timestamp", "UserID", "Username", "Amount", "Admin", "Note"]),
    '_payout_ledger': new InMemorySheet('_payout_ledger', ["TransactionID", "Timestamp", "UserID", "Username", "Amount Paid", "Admin"]),
    '_master_log': new InMemorySheet('_master_log', ["UserID", "Username", "Code", "Type", "Timestamp", "Price", "Batch ID", "Status", "Note"]),
};

// Function to get a worksheet by its title
async function getSheetByName(name) {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle[name];
    if (!sheet) {
        sheet = await doc.addSheet({ title: name, headerValues: SHEET_HEADERS });
    }
    return sheet;
}

// Mock for a Utility function
const Utilities = {
    formatDate: (date, timeZone, format) => date.toISOString().slice(0, 10),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)), // Proper sleep in async Node.js
    newBlob: (content, type, name) => ({ content, type, name }),
}

// =================================================================================
// ===== TELEGRAM API WRAPPERS (REPLACING UrlFetchApp) =============================
// =================================================================================

async function apiRequest(method, payload) {
    const url = `${TELEGRAM_API_URL}/${method}`;
    try {
        const response = await axios.post(url, payload, { validateStatus: null });
        const resData = response.data;
        if (resData.ok) {
            return resData.result;
        }
        // Log the error but continue execution
        // Logger.log(`API Error (${method}): ${JSON.stringify(resData)}`);
        return null;
    } catch(e) {
        // Logger.log(`API Exception (${method}): ${e.message}`);
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
    // Note: Proper file upload requires 'form-data' in Node.js, this is a mock.
    // Logger.log(`[MOCK] Sending document: ${document.name} to ${chat_id} with caption: ${caption}`);
    return sendText(chat_id, `[MOCK] Document ${document.name} sent with caption: ${caption}`);
}

async function answerCallbackQuery(callback_query_id) { 
    return apiRequest('answerCallbackQuery', { callback_query_id }); 
}

async function sendChatAction(chat_id, action = 'typing') { 
    return apiRequest('sendChatAction', { chat_id: String(chat_id), action }); 
}

// =================================================================================
// ===== HELPER & UTILITY FUNCTIONS (FULL IMPLEMENTATION) ==========================
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

function getSheetHeaders(sheet) {
    if (!sheet) return {};
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headerMap = {};
    headers.forEach((header, i) => { headerMap[header.toString().toLowerCase().trim()] = i + 1; });
    return headerMap;
}

function getUsers() {
    const CACHE_KEY = 'user_map';
    let cached = cache.getProperty(CACHE_KEY);
    if (cached) return JSON.parse(cached);
    
    const { sheet } = getUsersSheet();
    if (sheet.getLastRow() < 2) return { byId: {}, byUsername: {} };
    
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
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

function findUsernameById(userId) { return getUsers().byId[String(userId)] || null; }
function findUserIdByUsername(username) { return getUsers().byUsername[username.toLowerCase().replace('@', '')] || null; }

function getAdminChatId(forceLookup = false) {
    if(!forceLookup) {
        const adminIdFromCache = props.getProperty('adminChatId');
        if(adminIdFromCache) return adminIdFromCache;
    }
    const adminId = findUserIdByUsername(adminUsername);
    if (adminId) props.setProperty('adminChatId', adminId);
    return adminId;
}

// FIX: Simplified to rely solely on getSheetByName for creation/retrieval
function getSheetByUserId(userId) {
    const username = findUsernameById(userId);
    if (!username) { return { sheet: null, headers: null }; }
    let sheet = getSheetByName(username);
    if (!sheet) { return { sheet: null, headers: null }; } // Should only happen for underscore sheets
    return { sheet, headers: getSheetHeaders(sheet) };
}

function invalidateUserStatCaches(userId) {
    const keys = [
      `profile_stats_${userId}`, `mystats_stats_${userId}`,
      `pending_codes_${userId}`, `user_codes_${userId}`, `payments_${userId}`,
      'market_demand_data', 'enhanced_market_data', 'user_map',
      'all_codes_cache' // Added for refresh
    ];
    keys.forEach(key => cache.removeProperty(key));
}

async function recordUser(userId, username) {
    const users = getUsers();
    const currentUsername = users.byId[userId.toString()];
    if (!currentUsername) {
      const { sheet: usersSheet } = getUsersSheet();
      usersSheet.appendRow([userId, username]);
      cache.removeProperty('user_map');
    } else if (currentUsername !== username) {
      const { sheet: usersSheet } = getUsersSheet();
      const data = usersSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === userId.toString()) {
          data[i][1] = username;
          usersSheet.getRange(i + 1, 2).setValues([[username]]);
          cache.removeProperty('user_map');
          break;
        }
      }
    }
}

function getUserState(userId) { const data = props.getProperty('userStates'); return data ? (JSON.parse(data)[userId] || null) : null; }
function setUserState(userId, state) { const data = props.getProperty('userStates') || '{}'; const states = JSON.parse(data); states[userId] = state; props.setProperty('userStates', JSON.stringify(states)); }
function clearUserState(userId) { const data = props.getProperty('userStates'); if (!data) return; const states = JSON.parse(data); delete states[userId]; props.setProperty('userStates', JSON.stringify(states)); }

function getTotalPaidForUser(userId) {
    const cacheKey = `payments_${userId}`;
    const cached = cache.getProperty(cacheKey);
    if (cached) return parseFloat(cached);
    const sheet = getPaymentsLogSheet().sheet;
    if (sheet.getLastRow() < 2) return 0;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
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

function logPayoutTransaction(userId, username, amount, adminUsername) {
    const sheet = getPayoutLedgerSheet().sheet;
    const timestamp = new Date();
    const transactionId = `PAY-${timestamp.getTime()}`;
    sheet.appendRow([transactionId, timestamp, userId, username, amount.toFixed(2), adminUsername]);
}

function deleteUserDataSheet(userId) {
    const username = findUsernameById(userId);
    if (username) {
      delete userSheets[username]; 
    }
    invalidateUserStatCaches(userId);
}

function getAllUserCodes(userId) {
    const cacheKey = `user_codes_${userId}`;
    const cached = cache.getProperty(cacheKey);
    if (cached) return new Set(JSON.parse(cached));
    const { sheet, headers } = getSheetByUserId(userId);
    const codeSet = new Set();
    if (!sheet || sheet.getLastRow() < 2) return codeSet;
    const codeCol = headers['code'];
    if (!codeCol) return codeSet;
    const codeValues = sheet.getRange(2, codeCol, sheet.getLastRow() - 1, 1).getValues();
    codeValues.forEach(row => { if (row[0]) codeSet.add(row[0]); });
    cache.setProperty(cacheKey, JSON.stringify(Array.from(codeSet)));
    return codeSet;
}

function getAllUserSheets() {
    const allUsers = getUsers();
    const userSheetsData = {};
    for (const userId in allUsers.byId) {
        const username = allUsers.byId[userId];
        const sheet = getSheetByName(username);
        if (sheet) {
            userSheetsData[userId] = {
                sheet: sheet,
                headers: getSheetHeaders(sheet)
            };
        }
    }
    return userSheetsData;
}

function getCodesForBatch(userId, batchId) {
    const { sheet, headers } = getSheetByUserId(userId);
    const codes = [];
    if (!sheet || sheet.getLastRow() < 2) return codes;
    const batchIdCol = headers['batch id'], codeCol = headers['code'];
    if (!batchIdCol || !codeCol) return codes;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][batchIdCol - 1]) === String(batchId)) {
            codes.push(data[i][codeCol - 1]);
        }
    }
    return codes;
}

function getBatchDetails(userId, batchId) {
    const { sheet, headers } = getSheetByUserId(userId);
    if (!sheet || sheet.getLastRow() < 2) return null;
    const batchIdCol = headers['batch id'];
    const typeCol = headers['type'];
    const statusCol = headers['status'];
    const codeCol = headers['code'];
    if (!batchIdCol || !typeCol || !statusCol || !codeCol) return null;
    
    const data = sheet.getDataRange().getValues();
    let batchDetails = { codes: [], type: null, status: null, count: 0 };
    let found = false;
    
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][batchIdCol - 1]) === String(batchId)) {
            batchDetails.codes.push(data[i][codeCol - 1]);
            batchDetails.type = batchDetails.type || data[i][typeCol - 1];
            batchDetails.status = batchDetails.status || data[i][statusCol - 1];
            batchDetails.count++;
            found = true;
        }
    }
    return found ? batchDetails : null;
}

function aggregateUserBatches(userId, sheet, headers) {
    const batchIdCol = headers['batch id'];
    const typeCol = headers['type'];
    const statusCol = headers['status'];

    if (!batchIdCol || !typeCol || !statusCol || sheet.getLastRow() < 2) return {};

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    const batchData = {};

    for (const row of data) {
        const batchId = row[batchIdCol - 1];
        const type = row[typeCol - 1] || 'Unknown';
        let status = (row[statusCol - 1] || 'Pending').trim();
        status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

        if (batchId) {
            if (!batchData[batchId]) {
                batchData[batchId] = { type, count: 0, statusCounts: {} };
            }
            batchData[batchId].count++;
            if (!batchData[batchId].statusCounts[status]) {
                batchData[batchId].statusCounts[status] = 0;
            }
            batchData[batchId].statusCounts[status]++;
        }
    }

    for (const batchId in batchData) {
        const batch = batchData[batchId];
        if (batch.statusCounts['Pending']) {
            batch.status = 'Pending';
        } else if (batch.statusCounts['Listed']) {
            batch.status = 'Listed';
        } else if (batch.statusCounts['Paid']) {
            if (batch.statusCounts['Paid'] === batch.count) {
                 batch.status = 'Paid';
            } else {
                 batch.status = 'Partially Paid';
            }
        } else {
            batch.status = 'Processed';
        }
    }

    return batchData;
}

function calculateUserFinancials(userId) {
    const { sheet, headers } = getSheetByUserId(userId);
    let financials = {
        robTotalOwed: 0,
        otherTotalOwed: 0,
        robPricedCodes: 0,
        unpricedCodes: [],
        totalPaid: getTotalPaidForUser(userId),
        totalNetOwed: 0,
        statusCounts: {},
        typeStats: {}
    };

    if (sheet && sheet.getLastRow() > 1) {
        const priceCol = headers['price'], statusCol = headers['status'], typeCol = headers['type'];
        if (priceCol && statusCol && typeCol) {
            const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

            for (const row of data) {
                const price = parseFloat(row[priceCol - 1]);
                const originalType = (row[typeCol - 1] || 'Unknown');
                const type = originalType.toLowerCase();
                
                let status = (row[statusCol - 1] || 'Pending').trim();
                status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
                if (!financials.statusCounts[status]) financials.statusCounts[status] = 0;
                financials.statusCounts[status]++;
                
                if (!financials.typeStats[originalType]) {
                    financials.typeStats[originalType] = { priced: 0, unpriced: 0, total: 0 };
                }
                financials.typeStats[originalType].total++;
                if (!isNaN(price) && price > 0) {
                    financials.typeStats[originalType].priced++;
                } else {
                    financials.typeStats[originalType].unpriced++;
                }

                if (status.toLowerCase() !== 'paid') {
                    if (!isNaN(price) && price > 0) {
                        if (type.includes('roblox')) {
                            financials.robPricedCodes++;
                            financials.robTotalOwed += price;
                        } else {
                            financials.otherTotalOwed += price;
                        }
                    } else {
                        financials.unpricedCodes.push({ type: type });
                    }
                }
            }
        }
    }

    financials.totalNetOwed = (financials.robTotalOwed + financials.otherTotalOwed - financials.totalPaid);
    return financials;
}

function getPendingCodesForUser(userId) {
    const cacheKey = `pending_codes_${userId}`;
    const cached = cache.getProperty(cacheKey);
    if(cached) return JSON.parse(cached);
    const { sheet, headers } = getSheetByUserId(userId);
    const pendingCodes = { codes: [], pendingCount: 0 };
    if (!sheet || sheet.getLastRow() < 2) return pendingCodes;
    const statusCol = headers['status'], codeCol = headers['code'];
    if (!statusCol || !codeCol) return pendingCodes;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    for (const row of data) {
        const status = (row[statusCol - 1] || '').toString().trim().toLowerCase();
        const code = row[codeCol - 1];
        if (status === 'pending' && code) {
            pendingCodes.codes.push(code);
        }
    }
    pendingCodes.pendingCount = pendingCodes.codes.length;
    cache.setProperty(cacheKey, JSON.stringify(pendingCodes));
    return pendingCodes;
}

function updateAllPendingToListed(userId) {
    const { sheet, headers } = getSheetByUserId(userId);
    if (!sheet) return { updatedCount: 0 };
    const statusCol = headers['status'];
    if (!statusCol) return { updatedCount: 0 };
    const data = sheet.getDataRange().getValues();
    let updatedCount = 0;
    for (let i = 1; i < data.length; i++) {
        if ((data[i][statusCol - 1] || '').toString().trim().toLowerCase() === 'pending') {
            data[i][statusCol - 1] = 'Listed';
            updatedCount++;
        }
    }
    if (updatedCount > 0) {
        sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
        invalidateUserStatCaches(userId);
    }
    return { updatedCount };
}

function addNoteToBatch(userId, batchId, note) {
    const { sheet, headers } = getSheetByUserId(userId);
    if (!sheet) return { updatedCount: 0 };
    const batchIdCol = headers['batch id'];
    const noteCol = headers['note'];
    if (!batchIdCol || !noteCol) return { updatedCount: 0 };
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    let updatedCount = 0;
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][batchIdCol - 1]) === String(batchId)) {
            data[i][noteCol - 1] = note;
            updatedCount++;
        }
    }
    if (updatedCount > 0) {
        dataRange.setValues(data);
    }
    return { updatedCount };
}

function setPrice(userId, identifier, price) {
    const { sheet, headers } = getSheetByUserId(userId);
    if (!sheet) return { updatedCount: 0 };
    const batchIdCol = headers['batch id'], priceCol = headers['price'];
    if (!priceCol) return { updatedCount: 0 };
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    let updatedCount = 0;
    for (let i = 1; i < data.length; i++) {
        const currentPrice = data[i][priceCol - 1];
        const isUnpriced = currentPrice === '' || currentPrice === null || parseFloat(currentPrice) === 0;
        const batchMatch = batchIdCol && String(data[i][batchIdCol - 1]) === String(identifier);
        // Important: Only price if it's currently unpriced, unless identifier is a batch ID
        if ((identifier === '_ALL_UNPRICED_' && isUnpriced) || (batchMatch && isUnpriced)) {
            data[i][priceCol - 1] = price;
            updatedCount++;
        }
    }
    if (updatedCount > 0) {
        dataRange.setValues(data);
        invalidateUserStatCaches(userId);
    }
    return { updatedCount };
}

function deleteBatchById(userId, batchId) {
    const { sheet, headers } = getSheetByUserId(userId);
    if (!sheet || sheet.getLastRow() < 2) return { deletedCount: 0 };
    const batchIdCol = headers['batch id'];
    if (!batchIdCol) return { deletedCount: 0 };
    const data = sheet.getDataRange().getValues();
    const newData = [data[0]];
    let deletedCount = 0;
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][batchIdCol - 1]) !== String(batchId)) {
            newData.push(data[i]);
        } else {
            deletedCount++;
        }
    }
    if (deletedCount > 0) {
        sheet.clearContents();
        sheet.getRange(1, 1, newData.length, newData[0].length).setValues(newData);
        invalidateUserStatCaches(userId);
    }
    return { deletedCount };
}

function updateBatchStatus(userId, batchId, newStatus) {
    const { sheet, headers } = getSheetByUserId(userId);
    if (!sheet || sheet.getLastRow() < 2) return { updatedCount: 0 };
    const batchIdCol = headers['batch id'], statusCol = headers['status'];
    if (!batchIdCol || !statusCol) return { updatedCount: 0 };
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    let updatedCount = 0;
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][batchIdCol - 1]) === String(batchId)) {
            data[i][statusCol - 1] = newStatus;
            updatedCount++;
        }
    }
    if (updatedCount > 0) {
        dataRange.setValues(data);
        invalidateUserStatCaches(userId);
    }
    return { updatedCount };
}

function processUserPayout(userId, adminUsername) {
    const { sheet, headers } = getSheetByUserId(userId);
    if (!sheet || sheet.getLastRow() < 2) return { paidAmount: 0 };
    const priceCol = headers['price'], statusCol = headers['status'];
    if (!priceCol || !statusCol) return { paidAmount: 0 };
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    let payoutAmount = 0;
    for (let i = 1; i < data.length; i++) {
        const price = parseFloat(data[i][priceCol - 1]);
        const status = data[i][statusCol - 1];
        if ((status === 'Listed' || status === 'Processed') && !isNaN(price) && price > 0) {
            payoutAmount += price;
            data[i][statusCol - 1] = 'Paid';
        }
    }
    if (payoutAmount > 0) {
        dataRange.setValues(data);
        logPayoutTransaction(userId, findUsernameById(userId), payoutAmount, adminUsername);
        invalidateUserStatCaches(userId);
    }
    return { paidAmount: payoutAmount };
}

// =================================================================================
// ===== COMMAND & STATE HANDLERS (FULL ASYNC IMPLEMENTATION) ======================
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
        '/count':() => handleCountCommand(chatId),
        '/setreminder': async () => Logger.log('Trigger mock: createDailyReminderTrigger'), // Mock
        '/setupmarket': async () => Logger.log('Trigger mock: createMarketUpdateTrigger'), // Mock
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

async function handleStartCommand(chatId, userId, fromCallback = false) {
    if (!fromCallback) {
        await sendText(chatId, `👋 *Welcome, @${findUsernameById(userId)}!*\n\nTo begin, please select a code type from the menu below.`);
    }
    
    const username = findUsernameById(userId);
    const isAdmin = username === adminUsername;
    const isSpecialUser = specialUserUsernames.includes(username);

    const allowedCodeTypes = (isSpecialUser || isAdmin) ?
        [...CODE_TYPES_ALL_USERS, ...CODE_TYPES_SPECIAL_USERS] :
        CODE_TYPES_ALL_USERS;

    const keyboard = {
        keyboard: allowedCodeTypes.map(type => [type]),
        resize_keyboard: true, one_time_keyboard: true, input_field_placeholder: "Select a code type to submit"
    };
    const sentMessage = await sendText(chatId, "👇 Please select an item to submit.", { reply_markup: keyboard });
    if (sentMessage) {
        setUserState(userId, { action: 'awaiting_code_type', messageIdsToDelete: [sentMessage.message_id] });
    }
}

async function handleBalanceCommand(chatId, userId) {
    await sendChatAction(chatId, 'typing');
    const loadingMessage = await sendText(chatId, "⏳ Calculating your balance...");

    const financials = calculateUserFinancials(userId);
    const { totalNetOwed, unpricedCodes } = financials;

    let estimatedValue = 0;
    let unpricedCount = unpricedCodes.length;

    if (unpricedCount > 0) {
        const marketData = getEnhancedMarketData();
        const priceMap = marketData.priceStats.reduce((map, item) => {
            map[item.type.toLowerCase()] = parseFloat(item.avgPrice);
            return map;
        }, {});

        unpricedCodes.forEach(code => {
            const price = priceMap[code.type.toLowerCase()];
            if (price) {
                estimatedValue += price;
            }
        });
    }

    const totalEstimatedBalance = totalNetOwed + estimatedValue;

    let message = `💰 *Your Balance*\n\n`;
    message += `▪️ *Priced (Withdrawable):* \`$${totalNetOwed.toFixed(2)}\`\n`;
    message += `▪️ *Unpriced (Estimate):* \`~$${estimatedValue.toFixed(2)}\`\n\n`;
    message += `*Total Estimated Balance:* \`~$${totalEstimatedBalance.toFixed(2)}\`\n\n`;
    
    if (unpricedCount > 0) {
          message += `*Note:* You have ${unpricedCount} unpriced code(s). The estimate is based on current market rates and may change.`;
    }

    const keyboard = {
        inline_keyboard: [
            [{ text: "💵 Withdraw Priced Balance", callback_data: 'dorequestpayout' }],
            [{ text: "👤 View Full Profile", callback_data: 'doviewprofile' }]
        ]
    };

    await editMessageText(chatId, loadingMessage.message_id, message, { reply_markup: keyboard });
}

async function handleWithdrawCommand(chatId, userId) {
    const { totalNetOwed } = calculateUserFinancials(userId);

    if (totalNetOwed < MINIMUM_PAYOUT_AMOUNT) {
        await sendText(chatId, `❌ *Withdrawal Failed*\n\nYour withdrawable balance is *$${totalNetOwed.toFixed(2)}*. You need at least *$${MINIMUM_PAYOUT_AMOUNT.toFixed(2)}* to request a withdrawal.`);
        return;
    }

    const keyboard = {
        inline_keyboard: [
            [{ text: "🪙 MEXC ID", callback_data: 'payout_method_mexc' }],
            [{ text: "💲 USDT BEP20 Address", callback_data: 'payout_method_usdt' }]
        ]
    };

    await sendText(chatId, `💵 *Request a Withdrawal*\n\nYour available balance is *$${totalNetOwed.toFixed(2)}*.\n\nPlease choose your preferred payout method:`, { reply_markup: keyboard });
}

async function handleProfileCommand(chatId, requesterId, args = []) {
    await sendChatAction(chatId, 'typing');
    const isAdmin = findUsernameById(requesterId) === adminUsername;
    let targetUserId = requesterId;
    let targetUsername = findUsernameById(requesterId);

    if (isAdmin && args.length > 0 && args[0].startsWith('@')) {
        targetUsername = args[0];
        targetUserId = findUserIdByUsername(targetUsername);
        if (!targetUserId) {
            await sendText(chatId, `❌ User *\`${targetUsername}\`* not found.`);
            return;
        }
    }

    const { sheet } = getSheetByUserId(targetUserId);
    const totalSubmissions = (sheet && sheet.getLastRow() > 1) ? sheet.getLastRow() - 1 : 0;
    const totalWithdrawn = getTotalPaidForUser(targetUserId);

    const financials = calculateUserFinancials(targetUserId);
    const { totalNetOwed, robTotalOwed, otherTotalOwed, typeStats } = financials;

    let message = `👤 *Profile for ${targetUsername}*\n\n`;

    message += `*--- Lifetime Stats ---*\n`;
    message += `📈 *Total Submissions:* \`${totalSubmissions}\`\n`;
    message += `💳 *Total Withdrawn:* \`$${totalWithdrawn.toFixed(2)}\`\n\n`;

    message += `*--- Payout Summary ---*\n`;
    message += `Gross (Roblox): \`$${robTotalOwed.toFixed(2)}\`\n`;
    message += `Gross (Other): \`$${otherTotalOwed.toFixed(2)}\`\n`;
    message += `Already Paid: \`-$${totalWithdrawn.toFixed(2)}\`\n`;
    message += `💰 *Withdrawable Balance:* \`$${totalNetOwed.toFixed(2)}\`\n\n`;
    
    let personalStatsMessage = "📊 *Your Personal Stats*\n\n";
    let hasPersonalStats = false;
    for (const type in typeStats) {
        const stats = typeStats[type];
        if (stats.total > 0) {
            hasPersonalStats = true;
            personalStatsMessage += `*${type}:*\n`;
            personalStatsMessage += `  - Priced: \`${stats.priced}\`\n`;
            personalStatsMessage += `  - Unpriced: \`${stats.unpriced}\`\n`;
            personalStatsMessage += `  - Total: \`${stats.total}\`\n\n`;
        }
    }
    if (hasPersonalStats) {
        message += personalStatsMessage;
    }

    const keyboard = {
        inline_keyboard: [
            [{ text: "💰 Check Balance", callback_data: 'doviewbalance' }, { text: "📝 Submit New Code", callback_data: 'submitmore' }]
        ]
    };

    const options = (String(requesterId) === String(targetUserId)) ? { reply_markup: keyboard } : {};
    
    if (message.length > 4096) {
        message = message.substring(0, 4090) + "\n... (truncated)";
    }
    
    await sendText(chatId, message, options);
}

async function handleMyBatchesCommand(chatId, userId) {
    const loadingMessage = await sendText(chatId, "⏳ Fetching your batch information...");

    const { sheet, headers } = getSheetByUserId(userId);

    if (!sheet || sheet.getLastRow() < 2) {
        await editMessageText(chatId, loadingMessage.message_id, "ℹ️ You have not submitted any codes yet.");
        return;
    }

    const batches = aggregateUserBatches(userId, sheet, headers);

    if (Object.keys(batches).length === 0) {
        await editMessageText(chatId, loadingMessage.message_id, "ℹ️ Could not find any submission batches in your data.");
        return;
    }

    const sortedBatchIds = Object.keys(batches).sort((a, b) => b - a).slice(0, 15); // Show latest 15 batches
    
    let message = "📦 *Your Recent Submission Batches*\n\n";
    const keyboard = [];

    for (const batchId of sortedBatchIds) {
        const batch = batches[batchId];
        message += `*Batch ID:* \`${batchId}\`\n`;
        message += `▪️ *Type:* ${batch.type} (${batch.count} codes)\n`;
        message += `▪️ *Status:* **${batch.status}**\n\n`;
        
        keyboard.push([{ text: `📄 View Codes in Batch ${batchId}`, callback_data: `viewcodes_${batchId}` }]);
    }

    if (Object.keys(batches).length > 15) {
        message += "_... (showing the 15 most recent batches)_";
    }

    await editMessageText(chatId, loadingMessage.message_id, message, {
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleCodeSubmission(chatId, text, userId, userState) {
    const loadingMessage = await sendText(chatId, "⏳ Validating and processing your codes...");
    
    const submissionUserId = userId;
    const submissionUsername = findUsernameById(userId);

    const allSubmittedCodes = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (allSubmittedCodes.length === 0) {
        await editMessageText(chatId, loadingMessage.message_id, "❌ *No Codes Found*\n\nPlease send at least one code.");
        return;
    }

    const validFormatCodes = new Set();
    const invalidFormatCodes = new Set();
    allSubmittedCodes.forEach(code => { CODE_PATTERN_REGEX.test(code) ? validFormatCodes.add(code) : invalidFormatCodes.add(code); });

    if (validFormatCodes.size === 0) {
        let userMessage = `❌ *Submission Failed*\n\nNone of the ${allSubmittedCodes.length} code(s) you sent had a valid format.\n\n⚠️ *Rejected Codes:*\n\`\`\`\n${[...invalidFormatCodes].join('\n')}\n\`\`\``;
        await editMessageText(chatId, loadingMessage.message_id, userMessage);
        clearUserState(userId);
        return;
    }

    const { sheet } = getSheetByUserId(submissionUserId);
    if (!sheet) {
      await editMessageText(chatId, loadingMessage.message_id, "❌ *Error*\nCould not find or create your data sheet. Please contact an admin.");
      return;
    }
    const existingCodes = getAllUserCodes(submissionUserId);

    const uniqueNewCodes = [];
    const duplicateCodes = [];
    validFormatCodes.forEach(code => { existingCodes.has(code) ? duplicateCodes.push(code) : uniqueNewCodes.push(code); });

    if (uniqueNewCodes.length > 0) {
        const formattedTimestamp = Utilities.formatDate(new Date(), 'UTC', "MM/dd/yyyy"); // Using mock format date
        const batchId = new Date().getTime();

        const newRows = uniqueNewCodes.map(code => [code, userState.type, formattedTimestamp, "", batchId, "Pending", ""]);
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
        invalidateUserStatCaches(submissionUserId);

        const isAdminSubmitter = submissionUsername === adminUsername;
        const isSpecialSubmitter = specialUserUsernames.includes(submissionUsername);

        let notificationMessage = `📥 *New Submission from \`${submissionUsername}\`*\n\n${uniqueNewCodes.map(code => `▫️ ${userState.type} | Code: \`${code}\``).join('\n')}\n\n*Batch ID:* \`${batchId}\``;
        if (notificationMessage.length > 4096) {
            notificationMessage = `📥 *New Submission from \`${submissionUsername}\`*\n\n▫️ *Type:* \`${userState.type}\`\n▫️ *New Count:* \`${uniqueNewCodes.length}\`\n▫️ *Batch ID:* \`${batchId}\``;
        }

        const adminKeyboard = {
            inline_keyboard: [
                [{ text: "✅ Code Listed", callback_data: `listcode_${submissionUserId}_${batchId}` }, { text: "🗑️ Delete", callback_data: `admindelete_${submissionUserId}_${batchId}` }],
                [{ text: "✏️ Add Note", callback_data: `addnote_${submissionUserId}_${batchId}` }]
            ]
        };
        const specialUserKeyboard = { inline_keyboard: [[{ text: "✏️ Set Price For My Codes", callback_data: `setprice_${submissionUserId}_${batchId}` }]]};

        if (isSpecialSubmitter || isAdminSubmitter) {
          await sendText(submissionUserId, notificationMessage, { reply_markup: specialUserKeyboard });
        }
        
        const adminChatId = getAdminChatId();
        if (adminChatId && !isAdminSubmitter) {
            await sendText(adminChatId, notificationMessage, { reply_markup: adminKeyboard });
        }
    }
    
    let userMessage = `🎉 *Submission Complete for \`@${submissionUsername}\`!*\n\n`;
    if (uniqueNewCodes.length > 0) userMessage += `✅ Accepted: *${uniqueNewCodes.length}* new '${userState.type}' code(s).\n`;
    if (duplicateCodes.length > 0) userMessage += `🟡 Rejected *${duplicateCodes.length}* as duplicates.\n\`\`\`\n${duplicateCodes.join('\n')}\n\`\`\`\n`;
    if (invalidFormatCodes.size > 0) userMessage += `🔴 Rejected *${invalidFormatCodes.size}* with invalid format.\n\`\`\`\n${[...invalidFormatCodes].join('\n')}\n\`\`\`\n`;
    userMessage += "\nWhat would you like to do next?";
    const userKeyboard = {
        inline_keyboard: [
            [{ text: `➕ Submit More (${userState.type})`, callback_data: `submitsame_${userState.type}` }, { text: "📝 Submit Different", callback_data: 'submitmore' }],
            [{ text: "💰 Check Balance", callback_data: 'checkbalance' }]
        ]
    };
    await editMessageText(chatId, loadingMessage.message_id, userMessage, { reply_markup: userKeyboard });

    if (userState.messageIdsToDelete) userState.messageIdsToDelete.forEach(msgId => deleteMessage(chatId, msgId));
    clearUserState(userId);
}

async function handleBatchIdSearch(userId, chatId, text) {
    clearUserState(userId);
    const batchId = text.trim();
    const batchDetails = getBatchDetails(userId, batchId);

    if (!batchDetails) {
        await sendText(chatId, `❌ Batch ID \`${batchId}\` was not found in your submissions.`);
        return;
    }

    let message = `📦 *Details for Batch \`${batchId}\`*\n\n`;
    message += `▪️ *Type:* ${batchDetails.type} (${batchDetails.count} codes)\n`;
    message += `▪️ *Status:* **${batchDetails.status}**\n\n`;
    message += "📄 *Codes in this Batch*\n```\n" + batchDetails.codes.join('\n') + "\n```";

    if (message.length > 4096) message = message.substring(0, 4090) + "\n... (truncated)";
    
    const keyboard = { inline_keyboard: [[{ text: "⬅️ Back to Batch List", callback_data: 'backtobatches' }]] };
    await sendText(chatId, message, { reply_markup: keyboard });
}

async function handleCallbackQuery(callbackQuery) {
    const [action, ...dataParts] = callbackQuery.data.split('_');
    const data = dataParts.join('_');
    const from = callbackQuery.from;
    const chat = callbackQuery.message.chat;
    const messageId = callbackQuery.message.message_id;
    const fromUsername = `@${from.username}`;
    const isAdmin = fromUsername === adminUsername;

    await answerCallbackQuery(callbackQuery.id);

    // --- User Command Callbacks ---
    if (action === 'viewcodes') {
        const batchId = data;
        const batchDetails = getBatchDetails(from.id, batchId);
        if (!batchDetails) {
            await editMessageText(chat.id, messageId, `❌ Batch ID \`${batchId}\` was not found. The list might be outdated.`);
            return;
        }
        let message = `📦 *Details for Batch \`${batchId}\`*\n\n`;
        message += `▪️ *Type:* ${batchDetails.type} (${batchDetails.count} codes)\n`;
        message += `▪️ *Status:* **${batchDetails.status}**\n\n`;
        message += "📄 *Codes in this Batch*\n```\n" + batchDetails.codes.join('\n') + "\n```";
        if (message.length > 4096) message = message.substring(0, 4090) + "\n... (truncated)";
        const keyboard = { inline_keyboard: [[{ text: "⬅️ Back to Batch List", callback_data: 'backtobatches' }]] };
        await editMessageText(chat.id, messageId, message, { reply_markup: keyboard });
        return;
    }
    
    if (action === 'backtobatches') {
        await handleMyBatchesCommand(chat.id, from.id, messageId); // MessageId used for editing
        return;
    }
    
    if (action === 'searchbatch') {
        setUserState(from.id, { action: 'awaiting_batch_id' });
        await editMessageText(chat.id, messageId, "🔍 *Search Batch*\n\nPlease send the Batch ID you want to find.", {
            reply_markup: { inline_keyboard: [[{ text: "⬅️️ Back to Batch List", callback_data: 'backtobatches' }]]}
        });
        return;
    }

    if (action === 'payout' && dataParts[0] === 'method') {
        const method = dataParts[1];
        const methodText = (method === 'mexc') ? "MEXC ID" : "USDT BEP20 Address";
        await editMessageText(chat.id, messageId, `✅ Method selected: *${methodText}*\n\nPlease send your ${methodText} now.`);
        setUserState(from.id, { action: 'awaiting_payout_address', payoutMethod: method });
        return;
    }
    
    if (action === 'dorequestpayout') { await handleWithdrawCommand(chat.id, from.id); return; }
    if (action === 'doviewprofile') { await handleProfileCommand(chat.id, from.id); return; }
    if (action === 'doviewbalance') { await handleBalanceCommand(chat.id, from.id); return; }

    // --- Admin/Special User Callbacks ---
    if (isAdmin && action === 'proc') {
        const [_, command, targetUserId, batchId] = callbackQuery.data.split('_');
        if (command === 'price') {
            await editMessageText(chat.id, messageId, callbackQuery.message.text + "\n\n*➡️ Reply with the price for this entire batch.*");
            const state = getUserState(from.id) || {};
            setUserState(from.id, { ...state, action: 'awaiting_queue_price', targetUserId, batchId, originalMessageId: messageId });
        } else if (command === 'skip') {
            await handleSkipBatch(from.id, batchId, messageId);
        } else if (command === 'end') {
            clearUserState(from.id);
            await editMessageText(chat.id, messageId, "✅ Processing queue has been manually ended.");
        }
        return;
    }

    if (action === 'reqlistall') {
        await editMessageText(chat.id, messageId, "✅ Your request has been sent to the admin for approval.");
        const adminChatId = getAdminChatId();
        if(adminChatId) {
          const { pendingCount } = getPendingCodesForUser(from.id);
          if(pendingCount > 0) {
            let adminMessage = `🔔 *Listing Request*\nUser \`${fromUsername}\` is requesting to list *${pendingCount}* pending code(s).`;
            const keyboard = { inline_keyboard: [[{ text: `👍 List All ${pendingCount} Codes`, callback_data: `adminlistall_${from.id}` }]] };
            await sendText(adminChatId, adminMessage, { reply_markup: keyboard });
          }
        }
        return;
    }

    if (isAdmin && action === 'adminlistall') {
        const targetUserId = data;
        const targetUsername = findUsernameById(targetUserId);
        const { updatedCount } = updateAllPendingToListed(targetUserId);
        if (updatedCount > 0) {
            await editMessageText(chat.id, messageId, `✅ Approved! *${updatedCount}* codes for \`${targetUsername}\` have been marked as 'Listed'.`);
            await sendText(targetUserId, `🎉 *Good news!* Your request was approved and *${updatedCount}* of your codes have now been listed and are awaiting pricing.`);
        } else {
            await editMessageText(chat.id, messageId, `ℹ️ No pending codes were found for \`${targetUsername}\` to list.`);
        }
        return;
    }

    const userActions = {
        'submitmore': () => handleStartCommand(chat.id, from.id, true),
        'checkbalance': () => handleBalanceCommand(chat.id, from.id),
        'mydata': () => handleMyDataCommand(chat.id, from.id),
        'canceldelete': () => { editMessageText(chat.id, messageId, "👍 Action cancelled."); clearUserState(from.id); }
    };

    if (userActions[action]) {
        await userActions[action]();
        return;
    }

    if (action === 'submitsame') {
        setUserState(from.id, { action: 'submitting', type: data });
        await sendText(chat.id, `✅ *Selected: ${data}*\n\nNow, send your codes.`);
        return;
    }
    
    // --- Data Management Callbacks ---
    const [targetAction, targetUserId, batchId] = callbackQuery.data.split('_');

    if (action === 'deletebatch') {
        const confirmKeyboard = { inline_keyboard: [[{ text: "⚠️ Yes, Delete This Batch", callback_data: `confirmdelete_${data}` }, { text: "✖️ Cancel", callback_data: `canceldelete` }]] };
        await editMessageText(chat.id, messageId, `❓ *Are you sure?*\n\nThis will permanently delete the batch with ID \`${data}\`. This action cannot be undone.`, { reply_markup: confirmKeyboard });
    } else if (action === 'confirmdelete') {
        await editMessageText(chat.id, messageId, "⏳ Deleting...");
        const { deletedCount } = deleteBatchById(from.id, data);
        await editMessageText(chat.id, messageId, deletedCount > 0 ? "✅ Your batch has been successfully deleted." : "❗️ Could not delete batch.");
    } else if (action === 'resetdata') {
        const resetKeyboard = { inline_keyboard: [[{ text: "⚠️ Yes, Delete All My Data", callback_data: 'confirmreset' }, { text: "✖️ Cancel", callback_data: 'canceldelete' }]] };
        await editMessageText(chat.id, messageId, "‼️ *WARNING: Data Deletion*\n\nAre you sure you want to delete ALL of your data? This is irreversible.", { reply_markup: resetKeyboard });
    } else if (action === 'confirmreset') {
        await editMessageText(chat.id, messageId, "⏳ Deleting all your data...");
        deleteUserDataSheet(from.id); // Mock delete sheet
        await editMessageText(chat.id, messageId, "✅ All your data has been permanently deleted.");
        if (getAdminChatId()) await sendText(getAdminChatId(), `ℹ️ User \`${fromUsername}\` has reset their data.`);
    } else if (targetAction === 'setprice') {
        const isSpecialUser = specialUserUsernames.includes(fromUsername);
        const canSetPrice = isAdmin || (isSpecialUser && from.id.toString() === targetUserId.toString());
        if(canSetPrice) {
          const sentMessage = await sendText(chat.id, `*Set Price for Batch \`${batchId}\`*`);
          if (sentMessage) {
            setUserState(from.id, { action: 'awaiting_price', batchId, targetUserId, originalMessageText: callbackQuery.message.text, originalMessageId: messageId, replyPromptId: sentMessage.message_id });
          }
        }
    } else if (targetAction === 'setpriceallunpriced') {
        if(isAdmin) {
          const sentMessage = await sendText(chat.id, `*Set Price for All Unpriced Codes*\n\nReply to this message with the new price.`);
          if (sentMessage) {
            setUserState(from.id, { action: 'awaiting_price', batchId: '_ALL_UNPRICED_', targetUserId: targetUserId, originalMessageText: callbackQuery.message.text, originalMessageId: messageId, replyPromptId: sentMessage.message_id });
          }
        }
    }

    if (isAdmin) {
        if (action === 'reply') {
            const targetUsername = findUsernameById(data);
            setUserState(from.id, { action: 'in_conversation', withUserId: data, withUsername: targetUsername });
            await editMessageText(chat.id, messageId, `✅ You are now in a direct conversation with \`${targetUsername}\`.`);
            await sendText(from.id, `All subsequent messages you send will be forwarded automatically.\n\nType /endchat to exit this mode.`);
            return;
        }

        if (action === 'pinmarket') {
            const targetChatId = data;
            if (await pinMarketMessage(targetChatId)) {
                await editMessageText(chat.id, messageId, "✅ Market message has been pinned and will auto-update every 5 minutes.");
            } else {
                await editMessageText(chat.id, messageId, "❌ Failed to pin market message. Make sure the message still exists and the bot has pin permissions.");
            }
            return;
        }

        // --- Admin Pricing/Action Callbacks ---
        if (targetAction === 'addnote') {
            const sentMessage = await sendText(chat.id, `✏️ *Please reply with the note for batch \`${batchId}\`.*`);
            if (sentMessage) {
                setUserState(from.id, {
                    action: 'awaiting_note',
                    batchId: batchId,
                    targetUserId: targetUserId,
                    originalMessageText: callbackQuery.message.text,
                    originalMessageId: messageId,
                    replyPromptId: sentMessage.message_id
                });
            }
            return;
        }

        if (targetAction === 'admindelete') {
            const adminDeleteKeyboard = { inline_keyboard: [[{ text: "⚠️ Yes, Delete", callback_data: `confirmadmindelete_${targetUserId}_${batchId}` }, { text: "✖️ Cancel", callback_data: 'canceldelete' }]] };
            await editMessageText(chat.id, messageId, `❓ Admin, are you sure you want to delete batch \`${batchId}\` for user ID \`${targetUserId}\`?`, { reply_markup: adminDeleteKeyboard });
        } else if (targetAction === 'confirmadmindelete') {
            await editMessageText(chat.id, messageId, "⏳ Deleting batch...");
            const { deletedCount } = deleteBatchById(targetUserId, batchId);
            await editMessageText(chat.id, messageId, deletedCount > 0 ? `✅ Batch \`${batchId}\` for user ID \`${targetUserId}\` has been deleted.` : `❗️ Batch not found.`);
        }
        else if (targetAction === 'listcode') {
            const { updatedCount } = updateBatchStatus(targetUserId, batchId, 'Listed');
            if (updatedCount > 0) {
                const newText = callbackQuery.message.text + `\n\n*✅ Status: Codes Listed (${updatedCount})*`;
                const newKeyboard = { inline_keyboard: [
                    [ { text: "✏️ Set Price", callback_data: `setprice_${targetUserId}_${batchId}` }, { text: "🗑️ Delete", callback_data: `admindelete_${targetUserId}_${batchId}` } ],
                    [ { text: "✏️ Add Note", callback_data: `addnote_${targetUserId}_${batchId}` } ]
                ]};
                await editMessageText(chat.id, messageId, newText, { reply_markup: newKeyboard });
            } else {
                await editMessageText(chat.id, messageId, callbackQuery.message.text + "\n\n*❗️ Action Failed: No codes found to mark as listed.*", { reply_markup: {} });
            }
        }
        else if (targetAction === 'markallaspaid') {
            const { paidAmount } = processUserPayout(targetUserId, fromUsername);
            if (paidAmount > 0) {
                const targetUsername = findUsernameById(targetUserId);
                await editMessageText(chat.id, messageId, `✅ Successfully processed a payout of *${paidAmount.toFixed(2)}* for \`${targetUsername}\`.`);
                await sendText(targetUserId, `🎉 *You have been paid!* A payment of *${paidAmount.toFixed(2)}* for your listed codes has been processed.`);
            } else {
                await editMessageText(chat.id, messageId, `ℹ️ No pending payouts found for this user to process.`);
            }
        }
    }
}


async function handlePriceInput(adminUserId, text, state) {
    const price = parseFloat(text);
    if (isNaN(price) || price < 0) {
        await sendText(adminUserId, "❌ Invalid price. Please send a non-negative number.");
        return;
    }
    const { targetUserId, batchId, originalMessageText, originalMessageId, replyPromptId } = state;
    const { updatedCount } = setPrice(targetUserId, batchId, price);
    await deleteMessage(adminUserId, replyPromptId);
    if (updatedCount > 0) {
        const targetUsername = findUsernameById(targetUserId);
        if (batchId === '_ALL_UNPRICED_') {
            await sendText(adminUserId, `✅ Price set to *${price}* for *${updatedCount}* unpriced codes for user \`${targetUsername}\`.`);
            await sendText(targetUserId, `🔔 *Update:* ${updatedCount} of your submissions have now been priced at *${price}*!`);
            await editMessageText(adminUserId, originalMessageId, originalMessageText.replace(/--- Admin Actions ---[\s\S]*/, "*--- Admin Info ---\nAll pending codes have been priced.*"), {});
        } else {
            await sendText(adminUserId, `✅ Price set to *${price}* for batch \`${batchId}\` for user \`${targetUsername}\`.`);
            await sendText(targetUserId, `🔔 *Update:* Your submission (Batch \`${batchId}\`) has been priced at *${price}*!`);
            let newAdminText = originalMessageText.replace(/\*✅ Price Set: \d+(\.\d+)?\*/, `*✅ Price Set: ${price}*`);
            if (!newAdminText.includes('*✅ Price Set:')) newAdminText += `\n\n*✅ Price Set: ${price}*`;
            const updatedKeyboard = { inline_keyboard: [[ { text: "✏️ Set Price", callback_data: `setprice_${targetUserId}_${batchId}` }, { text: "🗑️ Delete", callback_data: `admindelete_${targetUserId}_${batchId}` } ]]};
            await editMessageText(adminUserId, originalMessageId, newAdminText, { reply_markup: updatedKeyboard });
        }
    } else {
        await sendText(adminUserId, `❗️ Could not find matching codes to update.`);
    }
    clearUserState(adminUserId);
}

async function handleQueuePriceInput(adminUserId, text, state) {
    const price = parseFloat(text);
    if (isNaN(price) || price < 0) {
        await sendText(adminUserId, "❌ Invalid price. Please try again.");
        return;
    }
    const { targetUserId, batchId, originalMessageId, forUser } = state;
    const { updatedCount } = setPrice(targetUserId, batchId, price);
    if (updatedCount > 0) {
        await editMessageText(adminUserId, originalMessageId, `✅ Price for batch \`${batchId}\` set to *${price}* for *${updatedCount}* items.`);
        await sendText(targetUserId, `🔔 *Update:* ${updatedCount} code(s) from your submission (Batch \`${batchId}\`) have now been priced at *${price}*!`);
    } else {
        await editMessageText(adminUserId, originalMessageId, `❗️ No unpriced codes were found in batch \`${batchId}\` to update.`);
    }
    const skippedIds = state.skippedBatchIds || [];
    clearUserState(adminUserId);
    await Utilities.sleep(1000);
    if (forUser) {
        await startUserProcessingQueue(adminUserId, forUser, skippedIds);
    } else {
        await startProcessingQueue(adminUserId, skippedIds);
    }
}

async function handleSkipBatch(adminId, batchId, messageId) {
    await editMessageText(adminId, messageId, `✅ Batch \`${batchId}\` skipped. Searching for next batch...`);
    const state = getUserState(adminId) || {};
    const skippedIds = state.skippedBatchIds || [];
    if (!skippedIds.includes(batchId)) {
        skippedIds.push(batchId);
    }
    setUserState(adminId, { ...state, skippedBatchIds: skippedIds });
    await Utilities.sleep(500);
    if (state.inQueueForUser) {
        await startUserProcessingQueue(adminId, state.inQueueForUser, skippedIds);
    } else {
        await startProcessingQueue(adminId, skippedIds);
    }
}

function displayBatchForProcessing(adminChatId, batchData) {
    const { userId, username, batchId, codes, type } = batchData;
    let message = `*Next Batch in Pricing Queue*\n\n`;
    message += `👤 *User:* \`${username}\`\n`;
    message += `📝 *Type:* \`${type}\`\n`;
    message += `📦 *Batch ID:* \`${batchId}\`\n`;
    message += `🔢 *Count:* ${codes.length} codes\n\n`;
    message += `*Codes in this batch:* (Tap to copy all)\n`;
    message += "```\n" + codes.join('\n') + "\n```\n";
    message += `Please set a price for all items in this batch.`
    const keyboard = {
        inline_keyboard: [[
            { text: `✏️ Set Price for ${codes.length} items`, callback_data: `proc_price_${userId}_${batchId}` },
            { text: '➡️ Skip Batch', callback_data: `proc_skip_${userId}_${batchId}` },
            { text: '🛑 End Queue', callback_data: `proc_end_${userId}_${batchId}` }
        ]]
    };
    return sendText(adminChatId, message, { reply_markup: keyboard });
}

function findNextProcessableBatch(skippedBatchIds = []) {
    const allUserSheets = getAllUserSheets();
    for (const userId in allUserSheets) {
        const batch = findNextProcessableBatchForUser(userId, allUserSheets[userId].sheet, allUserSheets[userId].headers, skippedBatchIds);
        if (batch) return batch;
    }
    return null;
}

function findNextProcessableBatchForUser(userId, sheet, headers, skippedBatchIds = []) {
    const username = findUsernameById(userId);
    if (!sheet || sheet.getLastRow() < 2) return null;
    const priceCol = headers['price'], statusCol = headers['status'], codeCol = headers['code'], typeCol = headers['type'], batchIdCol = headers['batch id'];
    if (!priceCol || !statusCol || !codeCol || !typeCol || !batchIdCol) return null;
    const data = sheet.getDataRange().getValues();
    const unpricedInBatches = {};
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const status = (row[statusCol - 1] || '').toString().trim().toLowerCase();
        const price = parseFloat(row[priceCol - 1]);
        const isPriced = !isNaN(price) && price > 0;
        if (status === 'listed' && !isPriced) {
            const batchId = row[batchIdCol - 1];
            if (batchId) {
                if (!unpricedInBatches[batchId]) {
                    unpricedInBatches[batchId] = { codes: [], type: row[typeCol-1] };
                }
                unpricedInBatches[batchId].codes.push(row[codeCol-1]);
            }
        }
    }
    for(const batchId in unpricedInBatches) {
        if (!skippedBatchIds.includes(batchId)) {
            return {
                userId: userId,
                username: username,
                batchId: batchId,
                codes: unpricedInBatches[batchId].codes,
                type: unpricedInBatches[batchId].type
            };
        }
    }
    return null;
}

async function startProcessingQueue(adminChatId, skippedBatchIds = []) {
    if (skippedBatchIds.length === 0) clearUserState(adminChatId);
    const nextBatch = findNextProcessableBatch(skippedBatchIds);
    if (nextBatch) {
        await displayBatchForProcessing(adminChatId, nextBatch);
    } else {
        await sendText(adminChatId, "✅ All 'Listed' codes have been priced. The global queue is empty.");
        clearUserState(adminChatId);
    }
}

async function startUserProcessingQueue(adminChatId, username, skippedBatchIds = []) {
    const targetUserId = findUserIdByUsername(username);
    if (!targetUserId) {
        await sendText(adminChatId, `❌ User *${username}* not found.`);
        return;
    }
    const state = getUserState(adminChatId) || {};
    setUserState(adminChatId, { ...state, inQueueForUser: username });
    const {sheet, headers} = getSheetByUserId(targetUserId);
    const nextBatch = findNextProcessableBatchForUser(targetUserId, sheet, headers, skippedBatchIds);
    if (nextBatch) {
        await displayBatchForProcessing(adminChatId, nextBatch);
    } else {
        await sendText(adminChatId, `✅ All 'Listed' codes for *${username}* have been priced. The queue for this user is empty.`);
        clearUserState(adminChatId);
    }
}

async function handleNoteInput(adminUserId, text, state) {
    const { targetUserId, batchId, originalMessageText, originalMessageId, replyPromptId } = state;
    await deleteMessage(adminUserId, replyPromptId);
    const { updatedCount } = addNoteToBatch(targetUserId, batchId, text);
    if (updatedCount > 0) {
        let newAdminText = originalMessageText;
        newAdminText = newAdminText.replace(/\n\n\*📝 Note:\*[\s\S]*/, '');
        newAdminText += `\n\n*📝 Note:* ${text}`;
        const updatedKeyboard = {
            inline_keyboard: [
                [{ text: "✅ Code Listed", callback_data: `listcode_${targetUserId}_${batchId}` }, { text: "🗑️ Delete", callback_data: `admindelete_${targetUserId}_${batchId}` }],
                [{ text: "✏️ Add/Edit Note", callback_data: `addnote_${targetUserId}_${batchId}` }]
            ]
        };
        await editMessageText(adminUserId, originalMessageId, newAdminText, { reply_markup: updatedKeyboard });
        await sendText(adminUserId, `✅ Note successfully added to batch \`${batchId}\`.`);
    } else {
        await sendText(adminUserId, `❗️ Could not find batch \`${batchId}\` to add a note to.`);
    }
    clearUserState(adminUserId);
}

async function handlePayoutAddressInput(userId, chatId, text, state) {
    const payoutMethod = state.payoutMethod;
    const address = text.trim();
    let isValid = false;
    let methodText = "";
    if (payoutMethod === 'mexc') {
        methodText = "MEXC ID";
        isValid = /^\d{8,10}$/.test(address);
    } else if (payoutMethod === 'usdt') {
        methodText = "USDT BEP20 Address";
        // Basic check for a standard Ethereum address format (BEP20 uses it)
        isValid = /^0x[a-fA-F0-9]{40}$/.test(address);
    }
    if (!isValid) {
        await sendText(chatId, `❌ *Invalid Format*\n\nThe ${methodText} you entered appears to be incorrect. Please check it and send it again.`);
        return;
    }
    const { totalNetOwed } = calculateUserFinancials(userId);
    if (totalNetOwed < MINIMUM_PAYOUT_AMOUNT) {
        await sendText(chatId, `❌ *Withdrawal Request Failed*\n\nYour available balance is now *$${totalNetOwed.toFixed(2)}*, which is below the *$${MINIMUM_PAYOUT_AMOUNT.toFixed(2)}* minimum.`);
        clearUserState(userId);
        return;
    }
    await sendText(chatId, `✅ *Withdrawal Request Submitted*\n\nYour request to withdraw *$${totalNetOwed.toFixed(2)}* has been received and is now pending review.`);
    const adminChatId = getAdminChatId();
    if (adminChatId) {
        const username = findUsernameById(userId);
        let adminMessage = `🔔 *New Withdrawal Request*\n\n`;
        adminMessage += `👤 *User:* \`${username}\` (ID: \`${userId}\`)\n`;
        adminMessage += `💰 *Amount:* \`$${totalNetOwed.toFixed(2)}\`\n`;
        adminMessage += `🏦 *Method:* \`${methodText}\`\n`;
        adminMessage += `📬 *Address/ID:*\n\`\`\`\n${address}\n\`\`\``;
        await sendText(adminChatId, adminMessage);
    }
    clearUserState(userId);
}

async function handleMessageCommand(adminUserId, args) {
    if (args.length < 2 || !args[0].startsWith('@')) {
        await sendText(adminUserId, "❌ *Invalid Syntax*\nUsage: `/message @username <message>`");
        return;
    }
    const targetUsername = args[0];
    const targetUserId = findUserIdByUsername(targetUsername);
    const messageText = args.slice(1).join(' ');

    if (!targetUserId) {
        await sendText(adminUserId, `❌ User \`${targetUsername}\` not found.`);
        return;
    }

    const result = await sendText(targetUserId, `*Message from Admin:*\n\n${messageText}`);
    if (result) {
        await sendText(adminUserId, `✅ Message successfully sent to \`${targetUsername}\`.`);
    } else {
        await sendText(adminUserId, `❌ Failed to send message to \`${targetUsername}\`. They may have blocked the bot.`);
    }
}

async function handleMyDataCommand(chatId, userId) {
    const loadingMessage = await sendText(chatId, "⏳ Preparing your data file...");
    const { sheet, headers } = getSheetByUserId(userId);
    if (!sheet || sheet.getLastRow() < 2) {
        await editMessageText(chatId, loadingMessage.message_id, "ℹ️ You have no data to export.");
        return;
    }
    try {
        const allData = sheet.getDataRange().getValues();
        let dataForExport = allData;
        const noteColumnIndex = headers['note'] ? headers['note'] - 1 : -1;
        if (noteColumnIndex !== -1) {
            dataForExport = allData.map(row =>
                row.filter((_, index) => index !== noteColumnIndex)
            );
        }
        let csvContent = dataForExport.map(row =>
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\r\n');
        const fileName = `data_export_${userId}_${new Date().getTime()}.csv`;
        const csvBlob = Utilities.newBlob(csvContent, 'text/csv', fileName);
        await sendDocument(chatId, csvBlob, "Here is your requested data export.");
        await editMessageText(chatId, loadingMessage.message_id, "✅ Your data file has been sent!");
    } catch (e) {
        Logger.log(`CSV Export Error for user ${userId}: ${e}`);
        await editMessageText(chatId, loadingMessage.message_id, "❌ An error occurred while generating your data file.");
    }
}

async function handleSummaryCommand(adminChatId, args) {
    clearUserState(adminChatId);
    if (args.length === 0 || !args[0] || !args[0].startsWith('@')) {
        await sendText(adminChatId, "Usage: `/summary @username`");
        return;
    }
    const targetUsername = args[0];
    const targetUserId = findUserIdByUsername(targetUsername);
    if (!targetUserId) {
        await sendText(adminChatId, `❌ User *\`${targetUsername}\`* not found.`);
        return;
    }
    const { sheet, headers } = getSheetByUserId(targetUserId);
    if (!sheet || sheet.getLastRow() < 2) {
        await sendText(adminChatId, `ℹ️ User *\`${targetUsername}\`* has no data.`);
        return;
    }
    const priceCol = headers['price'], codeCol = headers['code'], statusCol = headers['status'];
    if(!priceCol || !codeCol || !statusCol){
        await sendText(adminChatId, `📊 Sheet for *\`${targetUsername}\`* is in an old format.`);
        return;
    }
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    let totalOwed = 0, pricedCodes = 0, unpricedCodes = 0;
    for (const row of data) {
        if (row[codeCol - 1]) {
            const price = parseFloat(row[priceCol - 1]);
            const status = (row[statusCol - 1] || '').toString().trim().toLowerCase();
            if (!isNaN(price) && price > 0) { 
                pricedCodes++; 
                if (status !== 'paid') {
                    totalOwed += price;
                }
            }
            else { unpricedCodes++; }
        }
    }
    const sheetLink = 'https://mock.link/to/spreadsheet'; // Mock URL
    let message = `📊 *Summary for \`${targetUsername}\`*\n\n💰 *Total Owed (Non-Paid):* \`$${totalOwed.toFixed(2)}\`\n✅ *Priced Codes:* \`${pricedCodes}\`\n⏳ *Unpriced Codes:* \`${unpricedCodes}\`\n\n[View Sheet](${sheetLink})`;
    await sendText(adminChatId, message, { disable_web_page_preview: true });
}

async function handleSummaryAllCommand(adminChatId) {
    const loadingMessage = await sendText(adminChatId, "📊 Calculating live summary for all users... This may take a moment.");
    const allUserSheets = getAllUserSheets();
    let grandTotalOwed = 0, grandTotalPriced = 0, grandTotalUnpriced = 0, grandTotalSubmissions = 0;
    let userSummaryLines = [];
    let usersWithDataCount = 0;
    for (const userId in allUserSheets) {
        const {sheet, headers} = allUserSheets[userId];
        const username = findUsernameById(userId);
        if (!sheet || sheet.getLastRow() < 2) continue;
        const priceCol = headers['price'], codeCol = headers['code'], statusCol = headers['status'];
        if (!priceCol || !codeCol || !statusCol) continue;
        const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
        let userTotalSubmissions = 0, userPriced = 0, userUnpriced = 0, userOwed = 0;
        for (const row of data) {
            if (row[codeCol - 1]) {
                userTotalSubmissions++;
                const price = parseFloat(row[priceCol - 1]);
                if (!isNaN(price) && price > 0) {
                    userPriced++;
                    const status = (row[statusCol - 1] || '').toString().trim().toLowerCase();
                    if (status !== 'paid') {
                        userOwed += price;
                    }
                } else {
                    userUnpriced++;
                }
            }
        }
        if (userTotalSubmissions > 0) {
            usersWithDataCount++;
            grandTotalSubmissions += userTotalSubmissions;
            grandTotalPriced += userPriced;
            grandTotalUnpriced += userUnpriced;
            grandTotalOwed += userOwed;
            userSummaryLines.push(`▫️ *\`${username}\`* - Owed: \`$${userOwed.toFixed(2)}\`, Priced: \`${userPriced}\`, Unpriced: \`${userUnpriced}\``);
        }
    }
    let message = `*📊 All Users Summary (Live Data)*\n\n*OVERALL TOTALS*\n💰 *Grand Total Owed:* \`$${grandTotalOwed.toFixed(2)}\`\n✅ *Total Priced:* \`${grandTotalPriced}\`\n⏳ *Total Unpriced:* \`${grandTotalUnpriced}\`\n📈 *Total Submissions:* \`${grandTotalSubmissions}\`\n👥 *Total Users with Data:* \`${usersWithDataCount}\`\n\n*--- PER-USER BREAKDOWN ---*\n${userSummaryLines.join('\n')}`;
    if (message.length > 4096) {
        message = message.substring(0, 4000) + "\n\n*... (message truncated due to length)*";
    }
    await editMessageText(adminChatId, loadingMessage.message_id, message);
}

async function handleBroadcastCommand(adminChatId, messageText) {
    clearUserState(adminChatId);
    if(!messageText || messageText.trim() === '') {
        await sendText(adminChatId, "Broadcast cancelled."); return;
    }
    const loadingMessage = await sendText(adminChatId, "📣 Starting broadcast...");
    const recipients = Object.keys(getUsers().byId);
    let sentCount = 0, failCount = 0;
    for (const userChatId of recipients) {
        if (userChatId.toString() !== adminChatId.toString()) {
            try {
                if (await sendText(userChatId, "📣 *Message from Admin:*\n\n" + messageText)) sentCount++; else failCount++;
                await Utilities.sleep(100);
            } catch(e) { failCount++; Logger.log(e); }
        }
    }
    await editMessageText(adminChatId, loadingMessage.message_id, `✅ Broadcast complete.\n\n- Sent: ${sentCount}\n- Failed: ${failCount}`);
}

async function handleCountCommand(chatId) {
    const allUsers = getUsers();
    const userCount = Object.keys(allUsers.byId).length;
    let totalSubmissions = 0;
    Object.keys(allUsers.byId).forEach(userId => {
        const { sheet } = getSheetByUserId(userId);
        if (sheet && sheet.getLastRow() > 1) {
            totalSubmissions += sheet.getLastRow() - 1;
        }
    });
    const message = `📊 *System Stats*\n\n- Total Users: \`${userCount}\`\n- Total Submissions: \`${totalSubmissions}\``;
    await sendText(chatId, message);
}

async function handleRefreshCommand(chatId) {
    const loadingMessage = await sendText(chatId, "⏳ Rebuilding search index... Please wait.");
    const count = buildAndCacheAllCodes();
    await editMessageText(chatId, loadingMessage.message_id, `✅ Search index rebuilt successfully. Found and indexed ${count} total codes.`);
}

function buildAndCacheAllCodes() {
    Logger.log("Starting to build full code cache...");
    const allUserSheets = getAllUserSheets();
    const allCodes = {};
    let codeCount = 0;
    for (const userId in allUserSheets) {
        const {sheet, headers} = allUserSheets[userId];
        if (!sheet || sheet.getLastRow() < 2) continue;
        const codeCol = headers['code'], priceCol = headers['price'], timeCol = headers['timestamp'];
        if (!codeCol) continue;
        const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
        data.forEach(row => {
          const code = row[codeCol - 1];
          if(code) {
            allCodes[code] = {
              code: code,
              user: findUsernameById(userId),
              price: row[priceCol - 1] || null,
              timestamp: row[timeCol - 1] || null
            };
            codeCount++;
          }
        });
    }
    cache.setProperty('all_codes_cache', JSON.stringify(allCodes));
    Logger.log(`Finished building code cache. Total codes indexed: ${codeCount}`);
    return codeCount;
}

async function handleSearchCommand(adminChatId, args) {
    if (args.length === 0 || !args[0]) {
        await sendText(adminChatId, "Usage: `/search <partial or full code>`");
        return;
    }
    const searchTerm = args[0].toLowerCase();
    const loadingMessage = await sendText(adminChatId, `⚡️ Searching for codes matching \`${searchTerm}\`...`);
    const cachedCodes = cache.getProperty('all_codes_cache');
    if (!cachedCodes) {
        await editMessageText(adminChatId, loadingMessage.message_id, `⚠️ The search index is not built yet. Please run /refresh first.`);
        return;
    }
    const allCodes = JSON.parse(cachedCodes);
    const matches = [];
    for (const code in allCodes) {
        if (code.toLowerCase().includes(searchTerm)) {
            matches.push(allCodes[code]);
        }
    }
    if (matches.length === 0) {
        await editMessageText(adminChatId, loadingMessage.message_id, `❌ No codes found matching \`${searchTerm}\`.`);
        return;
    }
    let resultMessage = `✅ *Found ${matches.length} match(es) for "${searchTerm}":*\n`;
    matches.slice(0, 20).forEach(match => {
        const price = match.price || 'Unpriced';
        resultMessage += `\n▫️ \`${match.code}\` (*\`${match.user}\`*, Price: ${price})`;
    });
    if (matches.length > 20) {
        resultMessage += `\n\n*...and ${matches.length - 20} more results.*`;
    }
    await editMessageText(adminChatId, loadingMessage.message_id, resultMessage);
}

async function handleScanCommand(chatId) {
    const loadingMessage = await sendText(chatId, "⏳ Starting full scan of all user sheets to populate the master log. This may take a moment...");
    const allUserSheets = getAllUserSheets();
    const allRowsForMaster = [];
    for (const userId in allUserSheets) {
        const username = findUsernameById(userId);
        const { sheet, headers } = allUserSheets[userId];
        if (!sheet || sheet.getLastRow() < 2) continue;
        const requiredHeaders = ['code', 'type', 'timestamp', 'price', 'batch id', 'status'];
        if (!requiredHeaders.every(h => headers[h])) {
            Logger.log(`Skipping sheet for ${username} due to missing headers.`);
            continue;
        }
        const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
        for (const row of data) {
            const masterRow = [
                userId, username,
                row[headers['code'] - 1], row[headers['type'] - 1],
                row[headers['timestamp'] - 1], row[headers['price'] - 1],
                row[headers['batch id'] - 1], row[headers['status'] - 1]
            ];
            allRowsForMaster.push(masterRow);
        }
    }
    if (allRowsForMaster.length > 0) {
        const masterSheet = getMasterSheet().sheet;
        if (masterSheet.getLastRow() > 1) {
            masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, masterSheet.getLastColumn()).clearContent();
        }
        masterSheet.getRange(2, 1, allRowsForMaster.length, allRowsForMaster[0].length).setValues(allRowsForMaster);
        await editMessageText(chatId, loadingMessage.message_id, `✅ Scan complete. Populated the master log with ${allRowsForMaster.length} records from all user sheets.`);
    } else {
        await editMessageText(chatId, loadingMessage.message_id, "ℹ️ No data found in any user sheet to scan.");
    }
}

async function handleMarketCommand(chatId) {
    const loadingMessage = await sendText(chatId, "📈 Analyzing market trends and live pricing data...");
    const marketMessageContent = buildMarketMessage(chatId);
    const sentMessage = await editMessageText(chatId, loadingMessage.message_id, marketMessageContent);
    if (sentMessage) {
        await storeMarketMessageInfo(chatId, sentMessage.message_id);
        const isAdmin = findUsernameById(chatId) === adminUsername;
        if (isAdmin) {
            const pinKeyboard = {
                inline_keyboard: [[{ text: "📌 Pin & Auto-Update This Message", callback_data: `pinmarket_${chatId}` }]]
            };
            await sendText(chatId, "Market data loaded. You can pin this message for automatic updates.", { reply_markup: pinKeyboard });
        } else {
            // Non-admin can try to pin too, though permissions may fail
            await pinMarketMessage(chatId);
        }
    }
}

function getEnhancedMarketData() {
    const cacheKey = 'enhanced_market_data';
    const cached = cache.getProperty(cacheKey);
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch (e) {
            Logger.log(`Error parsing cached market data: ${e}. Rebuilding cache.`);
            cache.removeProperty(cacheKey);
        }
    }
    
    // Fallback/Manual data setup (no actual sheet reading in this mock)
    const manualOverrides = JSON.parse(props.getProperty('manual_demand_overrides') || '{}');
    const manualPrices = JSON.parse(props.getProperty('manual_market_prices') || '{}');
    const allTypes = [...VALID_CODE_TYPES];
    const priceStats = allTypes.map(type => {
        const manualPrice = manualPrices[type.toLowerCase()];
        const avgPrice = manualPrice ? manualPrice.avgPrice : '0.00';
        const maxPrice = manualPrice ? manualPrice.maxPrice : '0.00';
        const telegraphLink = manualPrice ? manualPrice.telegraphLink : null; 
        return { type, avgPrice, maxPrice, telegraphLink };
    });
    const result = {
        priceStats: priceStats.map((item) => {
            let demandText, demandIcon, level;
            const manualLevel = manualOverrides[item.type.toLowerCase()];
            if (manualLevel) {
                level = manualLevel;
            } else {
                level = 'low'; // Default low if not set
            }
            switch (level) {
                case 'high': demandText = "High Demand"; demandIcon = "📈"; break;
                case 'medium': demandText = "Medium Demand"; demandIcon = "📊"; break;
                case 'low': demandText = "Low Demand"; demandIcon = "📉"; break;
                default: demandText = "Unknown"; demandIcon = "❓"; break;
            }
            return {
                type: item.type,
                demandText, demandIcon, level: level,
                avgPrice: item.avgPrice, maxPrice: item.maxPrice,
                telegraphLink: item.telegraphLink
            };
        })
    };
    cache.setProperty(cacheKey, JSON.stringify(result));
    return result;
}

async function handleManageMarketCommand(chatId) {
    const marketData = getEnhancedMarketData();
    let message = `⚙️ *Market Management*\n\nSelect an item to edit its price and demand level.\n\n`;
    const keyboard = {
        inline_keyboard: marketData.priceStats.map(item => ([
            { text: `✏️ Edit ${item.type}`, callback_data: `editmarket_${item.type.replace(/ /g, '_')}` }
        ]))
    };
    await sendText(chatId, message, { reply_markup: keyboard });
}

async function handleMarketEditInput(adminUserId, text, state) {
    const { codeType, replyPromptId, originalMenuId } = state;
    await deleteMessage(adminUserId, replyPromptId);
    clearUserState(adminUserId);
    const demandOverrides = JSON.parse(props.getProperty('manual_demand_overrides') || '{}');
    const manualPrices = JSON.parse(props.getProperty('manual_market_prices') || '{}');
    const typeKey = codeType.toLowerCase();
    if (text.toLowerCase() === 'reset') {
        delete demandOverrides[typeKey];
        delete manualPrices[typeKey];
        await sendText(adminUserId, `✅ Market settings for *${codeType}* have been reset.`);
    } else {
        const parts = text.trim().split(/\s+/);
        if (parts.length < 3 || parts.length > 4) {
            await sendText(adminUserId, "❌ Invalid format. Please enter values.\n*Format:* `avg_price max_price level [telegraph_link]`\n*Example:* `5.50 8.00 high https://telegra.ph/link-01-01`\n\n(Send `reset` to clear settings for this item)");
            return;
        }
        const avgPrice = parseFloat(parts[0]);
        const maxPrice = parseFloat(parts[1]);
        const level = parts[2].toLowerCase();
        const telegraphLink = parts.length === 4 ? parts[3] : null;
        const validLevels = ['high', 'medium', 'low'];
        if (!validLevels.includes(level)) {
            await sendText(adminUserId, `❌ Invalid level. Please use one of: \`${validLevels.join(', ')}\`.`);
            return;
        }
        if (isNaN(avgPrice) || isNaN(maxPrice) || avgPrice < 0 || maxPrice < 0 || avgPrice > maxPrice) {
            await sendText(adminUserId, "❌ Invalid prices. Please provide valid positive numbers, and avg must not be greater than max.");
            return;
        }
        
        demandOverrides[typeKey] = level;
        manualPrices[typeKey] = {
            avgPrice: avgPrice.toFixed(2),
            maxPrice: maxPrice.toFixed(2),
            lastUpdated: new Date().toISOString(),
            telegraphLink: telegraphLink
        };
        let message = `✅ *Market for "${codeType}" has been updated:*\n`;
        message += `  - Average Price: *${avgPrice.toFixed(2)}*\n`;
        message += `  - Max Price: *${maxPrice.toFixed(2)}*\n`;
        message += `  - Demand Level: *${level}*`;
        if (telegraphLink) {
              message += `\n  - Details Link: *Set*`;
        }
        await sendText(adminUserId, message);
    }
    props.setProperty('manual_demand_overrides', JSON.stringify(demandOverrides));
    props.setProperty('manual_market_prices', JSON.stringify(manualPrices));
    invalidateUserStatCaches(null);
    await updateAllMarketMessages();
    if (originalMenuId) {
        await deleteMessage(adminUserId, originalMenuId);
    }
    await handleManageMarketCommand(adminUserId);
}

async function storeMarketMessageInfo(chatId, messageId) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
        const marketMessages = JSON.parse(props.getProperty('market_messages') || '{}');
        marketMessages[chatId] = {
            messageId: messageId,
            lastAttempt: new Date().toISOString(),
            lastSuccessfulUpdate: new Date().toISOString(),
            pinned: false
        };
        props.setProperty('market_messages', JSON.stringify(marketMessages));
    } finally {
        lock.releaseLock();
    }
}

async function pinMarketMessage(chatId) {
    const marketMessages = JSON.parse(props.getProperty('market_messages') || '{}');
    if (marketMessages[chatId]) {
        try {
            // Telegram pin API is used directly here
            const result = await apiRequest('pinChatMessage', {
                chat_id: chatId,
                message_id: marketMessages[chatId].messageId,
                disable_notification: true
            });
            if (result) {
                const lock = LockService.getScriptLock();
                lock.waitLock(15000);
                try {
                    const currentMarketMessages = JSON.parse(props.getProperty('market_messages') || '{}');
                    if(currentMarketMessages[chatId]) {
                        currentMarketMessages[chatId].pinned = true;
                        props.setProperty('market_messages', JSON.stringify(currentMarketMessages));
                    }
                } finally {
                    lock.releaseLock();
                }
                return true;
            } else {
                // Logger.log(`Failed to pin message in chat ${chatId}.`);
                return false;
            }
        } catch (error) {
            // Logger.log(`Exception while pinning message in chat ${chatId}: ${error}`);
            return false;
        }
    }
    return false;
}

async function updateAllMarketMessages() {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
        const marketMessages = JSON.parse(props.getProperty('market_messages') || '{}');
        const messagesToKeep = { ...marketMessages };
        for (const chatId in marketMessages) {
            const messageInfo = messagesToKeep[chatId];
            messageInfo.lastAttempt = new Date().toISOString();
            try {
                const messageContent = buildMarketMessage(chatId);
                const result = await editMessageText(chatId, messageInfo.messageId, messageContent);
                if (result) {
                    messageInfo.lastSuccessfulUpdate = new Date().toISOString();
                } else {
                    // Logger.log(`Failed to update market message for chat ${chatId} (ID: ${messageInfo.messageId}). It will be removed from the update list.`);
                    delete messagesToKeep[chatId];
                }
            } catch (error) {
                // Logger.log(`CRITICAL ERROR updating market message for chat ${chatId}: ${error}. It will be removed from the update list.`);
                delete messagesToKeep[chatId];
            }
        }
        props.setProperty('market_messages', JSON.stringify(messagesToKeep));
    } finally {
        lock.releaseLock();
    }
}

function buildMarketMessage(chatId) {
    const marketData = getEnhancedMarketData();
    const username = findUsernameById(chatId);
    const isAdmin = username === adminUsername;
    const isSpecialUser = specialUserUsernames.includes(username);
    let message = `*📈 Live Market Intelligence*\n`;
    message += `*Last Updated:* ${new Date().toLocaleString()}\n\n`;
    message += `*--- Market Status ---*\n`;
    const allowedCodeTypes = (isSpecialUser || isAdmin) ?
        [...CODE_TYPES_ALL_USERS, ...CODE_TYPES_SPECIAL_USERS] :
        CODE_TYPES_ALL_USERS;
    const groupedItems = {};
    marketData.priceStats.forEach(item => {
        if (!allowedCodeTypes.includes(item.type)) return;
        let groupName = "Other";
        if (item.type.includes('Roblox')) groupName = "Roblox";
        if (item.type.includes('ow')) groupName = "Overwatch";
        if (item.type.includes('minecoin')) groupName = "Minecraft";
        if (item.type.includes('lol')) groupName = "League of Legends";
        if (item.type.includes('pc game pass')) groupName = "PC Game Pass";
        if (!groupedItems[groupName]) {
            groupedItems[groupName] = [];
        }
        groupedItems[groupName].push(item);
    });
    for (const groupName in groupedItems) {
        message += `*${groupName}*\n`;
        groupedItems[groupName].forEach(item => {
            const avgPrice = parseFloat(item.avgPrice).toFixed(2);
            const maxPrice = parseFloat(item.maxPrice).toFixed(2);
            message += `${item.demandIcon} *${item.type}:*\n`;
            message += `    💰 Avg: \`${avgPrice}\` | Max: \`${maxPrice}\``;
            if (item.telegraphLink) {
                message += ` | [Details](${item.telegraphLink})\n`;
            } else {
                message += `\n`;
            }
            message += `    Demand: *${item.demandText}*\n\n`;
        });
    }
    return message;
}

// =================================================================================
// ===== CORE BOT LOGIC (Node.js Entry Point) ======================================
// =================================================================================

// The original doPost function logic, now an Express middleware
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
        recordUser(from.id, fromUsername);

        if (text.toLowerCase() === '/cancel') {
            clearUserState(from.id);
            await sendText(from.id, "✅ Action cancelled. You can now use other commands.");
            return res.status(200).send('OK');
        }

        const state = getUserState(from.id);

        if (state && state.action === 'awaiting_batch_id') {
            await handleBatchIdSearch(from.id, chat.id, text);
            return res.status(200).send('OK');
        }

        if (isAdmin && state && state.action === 'in_conversation') {
            if (text === '/endchat') {
                clearUserState(from.id);
                await sendText(from.id, `✅ Conversation with \`${state.withUsername}\` has ended.`);
                return res.status(200).send('OK');
            }
            const result = await sendText(state.withUserId, text);
            if (!result) {
                await sendText(from.id, `❌ Failed to send message to \`${state.withUsername}\`. They may have blocked the bot. Conversation ended.`);
                clearUserState(from.id);
            }
            return res.status(200).send('OK');
        }

        if (state) {
          if (state.action === 'awaiting_price') { await handlePriceInput(from.id, text, state); return res.status(200).send('OK'); }
          if (isAdmin && state.action === 'awaiting_queue_price') { await handleQueuePriceInput(from.id, text, state); return res.status(200).send('OK'); }
          if (isAdmin && state.action === 'awaiting_broadcast') { await handleBroadcastCommand(from.id, text); return res.status(200).send('OK'); }
          if (isAdmin && state.action === 'awaiting_market_edit') { await handleMarketEditInput(from.id, text, state); return res.status(200).send('OK'); }
          if (isAdmin && state.action === 'awaiting_note') { await handleNoteInput(from.id, text, state); return res.status(200).send('OK'); }
          if (state.action === 'awaiting_payout_address') { await handlePayoutAddressInput(from.id, chat.id, text, state); return res.status(200).send('OK'); }
        }

        if (text.startsWith('/')) {
            await handleCommand(text, from, chat, isAdmin);
            return res.status(200).send('OK');
        }

        const userState = getUserState(from.id);
        if (VALID_CODE_TYPES.includes(text)) {
            const isSpecialUser = specialUserUsernames.includes(findUsernameById(from.id));
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
            const adminChatId = getAdminChatId();
            if(adminChatId){
              let message = `*Incoming Message from \`${fromUsername}\`*\n\n${text}`;
              const keyboard = { inline_keyboard: [[{ text: `✍️ Reply to ${fromUsername}`, callback_data: `reply_${from.id}` }]] };
              await sendText(adminChatId, message, { reply_markup: keyboard });
            }
        }

    } catch (error) {
        Logger.log(`CRITICAL ERROR in handleWebhookRequest: ${error.message}\nStack: ${error.stack}\nEvent Data: ${JSON.stringify(contents)}`);
        const adminChatId = getAdminChatId();
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
app.listen(PORT, () => {
    console.log(`Node.js Telegram Bot server listening on port ${PORT}`);
    console.log(`NOTE: This code uses IN-MEMORY STORAGE. Data will be LOST if the server restarts.`);
    console.log(`Install dependencies with: npm install express body-parser axios`);
});