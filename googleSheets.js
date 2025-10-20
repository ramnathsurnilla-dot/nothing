// googleSheets.js

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const config = require('./config');

// --- AUTH & SETUP ---
let sheets;
try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
    const auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key?.replace(/\\n/g, '\n'), // Fix: Ensure private key handles escaped newlines
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheets = google.sheets({ version: 'v4', auth });
} catch (error) {
    console.error("CRITICAL: Failed to parse GOOGLE_CREDENTIALS or setup auth.", error.message);
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
let userMapCache = null;

// --- UTILITIES ---
const getHeaders = (data) => data[0]?.map(h => h.toLowerCase().trim()) || [];
const findCol = (headers, name) => headers.indexOf(name);
const normalizeCode = (code) => String(code).trim(); // Utility for consistent code comparison

const ensureSheetExists = async (title) => {
    if (!sheets || !SPREADSHEET_ID) return false; // Added SPREADSHEET_ID check
    try {
        const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetExists = spreadsheetInfo.data.sheets.some(s => s.properties.title === title);
        if (!sheetExists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: { requests: [{ addSheet: { properties: { title } } }] },
            });
            // Using config.SHEET_HEADERS which is assumed to be an array of strings
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${title}!A1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [config.SHEET_HEADERS] },
            });
        }
        return true;
    } catch (error) {
        console.error(`Error in ensureSheetExists for "${title}":`, error.message);
        return false;
    }
};

const getSheetData = async (sheetName) => {
    if (!sheets || !SPREADSHEET_ID) return [];
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:G`,
        });
        return response.data.values || [];
    } catch (error) {
        // Suppress 400 errors which usually indicate a missing sheet
        if (error.code !== 400 && error.message.indexOf('Unable to parse range') === -1) {
            console.error(`Error getting data from sheet "${sheetName}":`, error.message);
        }
        return [];
    }
};


// --- USER MANAGEMENT ---
const getUsers = async () => {
    if (userMapCache) return userMapCache;
    await ensureSheetExists('_users');
    const rows = await getSheetData('_users');
    const userMap = { byId: {}, byUsername: {} };
    
    // Assuming _users sheet headers are in A1: ID, Username
    if (rows.length > 1) {
        for (const row of rows.slice(1)) {
            const [id, username] = row;
            if (id && username) {
                const userIdStr = String(id).trim();
                const usernameStr = String(username).trim();
                userMap.byId[userIdStr] = usernameStr;
                userMap.byUsername[usernameStr.toLowerCase()] = userIdStr;
            }
        }
    }
    userMapCache = userMap;
    return userMap;
};

const recordUser = async (userId, username) => {
    const users = await getUsers();
    const userIdStr = String(userId).trim();
    const usernameStr = String(username).trim();

    // Check against both ID and potentially updated username
    if (!users.byId[userIdStr] || users.byId[userIdStr] !== usernameStr) {
        // In a real app, you might check by ID first, then update username if changed.
        // For simple append, we just check if ID is new.
        if (!users.byId[userIdStr]) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: '_users!A:B',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[userIdStr, usernameStr]] },
            });
            userMapCache = null; // Invalidate cache
        }
    }
};

const findUsernameById = async (userId) => {
    const users = await getUsers();
    return users.byId[String(userId).trim()] || null;
};

const deleteUserData = async (username) => {
    if (!sheets || !SPREADSHEET_ID) return;
    try {
        const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheet = spreadsheetInfo.data.sheets.find(s => s.properties.title === username);
        if (sheet) {
            const sheetId = sheet.properties.sheetId;
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: { requests: [{ deleteSheet: { sheetId } }] }
            });
        }
    } catch (error) {
        console.error(`Error deleting sheet for user "${username}":`, error.message);
    }
};

// --- DATA OPERATIONS ---
const handleCodeSubmission = async (username, codeType, codes) => {
    await ensureSheetExists(username);
    const allData = await getSheetData(username);
    
    // Use normalizeCode for robust comparison
    const existingCodes = new Set(allData.slice(1).map(row => normalizeCode(row[0])));

    const uniqueNewCodes = [];
    const duplicateCodes = [];
    const invalidFormatCodes = [];
    // Ensure incoming codes are unique and normalized
    const submittedCodes = new Set(codes.map(normalizeCode));

    submittedCodes.forEach(code => {
        if (!config.CODE_PATTERN_REGEX.test(code)) invalidFormatCodes.push(code);
        else if (existingCodes.has(code)) duplicateCodes.push(code);
        else uniqueNewCodes.push(code);
    });

    if (uniqueNewCodes.length > 0) {
        // Use ISO format for better sorting/parsing, then local date for user display/spreadsheet view
        const timestamp = new Date().toLocaleString('en-US'); 
        const batchId = new Date().getTime();
        // Columns: Code, Type, Timestamp, Price, Batch ID, Status, Notes
        const newRows = uniqueNewCodes.map(code => [code, codeType, timestamp, "", batchId, "Pending", ""]);
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${username}!A:G`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: newRows },
        });
    }
    return { acceptedCount: uniqueNewCodes.length, duplicateCodes, invalidFormatCodes };
};

const aggregateUserBatches = async (username) => {
    const allData = await getSheetData(username);
    if (allData.length <= 1) return {};

    const headers = getHeaders(allData);
    const batchIdCol = findCol(headers, 'batch id');
    const typeCol = findCol(headers, 'type');
    const statusCol = findCol(headers, 'status');
    const batchData = {};

    allData.slice(1).forEach(row => {
        const batchId = String(row[batchIdCol] || '').trim();
        if (batchId) {
            if (!batchData[batchId]) {
                batchData[batchId] = { type: row[typeCol], count: 0, statusCounts: {} };
            }
            batchData[batchId].count++;
            const status = (row[statusCol] || 'Pending').trim();
            batchData[batchId].statusCounts[status] = (batchData[batchId].statusCounts[status] || 0) + 1;
        }
    });

    for (const batchId in batchData) {
        const batch = batchData[batchId];
            
        // FIX: Corrected status logic flow. Order matters: Pending > Listed > Paid/Partially Paid
        if (batch.statusCounts['Pending']) {
            batch.status = 'Pending';
        } else if (batch.statusCounts['Listed']) {
            batch.status = 'Listed';
        } else if (batch.statusCounts['Paid'] === batch.count) {
            batch.status = 'Paid';
        } else if (batch.statusCounts['Paid'] && batch.statusCounts['Paid'] < batch.count) {
            batch.status = 'Partially Paid';
        } else {
            // Covers all other scenarios like 'Rejected', 'Verified', etc.
            batch.status = 'Processed'; 
        }
    }
    return batchData;
};

const getBatchDetails = async (username, batchId) => {
    const allData = await getSheetData(username);
    if (allData.length <= 1) return null;

    const headers = getHeaders(allData);
    const batchIdCol = findCol(headers, 'batch id');
    const codeCol = findCol(headers, 'code');
    const typeCol = findCol(headers, 'type');
    const statusCol = findCol(headers, 'status');
    const targetBatchId = String(batchId).trim(); // Normalize lookup
    
    const details = { codes: [], type: '', status: 'Unknown', count: 0 };
    const statusCounts = {};

    allData.slice(1).forEach(row => {
        if (String(row[batchIdCol] || '').trim() === targetBatchId) { // Normalize sheet value
            details.codes.push(row[codeCol]);
            details.type = details.type || row[typeCol]; // Set type only once
            const status = (row[statusCol] || 'Pending').trim();
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
    });
    
    details.count = details.codes.length;
    if (details.count === 0) return null;

    // Calculate overall status based on status counts
    if (statusCounts['Pending']) details.status = 'Pending';
    else if (statusCounts['Listed']) details.status = 'Listed';
    else if (statusCounts['Paid'] === details.count) details.status = 'Paid';
    else if (statusCounts['Paid'] && statusCounts['Paid'] < details.count) details.status = 'Partially Paid';
    else details.status = 'Processed';

    return details;
};

const getUserDataAsCsv = async (username) => {
    const allData = await getSheetData(username);
    if (allData.length === 0 || (allData.length === 1 && allData[0].every(c => !c))) return null; // Check for only headers/empty sheet

    return allData.map(row => 
        row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',') // Added || '' for safety
    ).join('\r\n');
};

const calculateUserFinancials = async (username) => {
    const allData = await getSheetData(username);
    const financials = {
        totalNetOwed: 0, unpricedCount: 0, totalSubmissions: 0, typeStats: {}
    };
    if (allData.length <= 1) return financials;

    const headers = getHeaders(allData);
    const priceCol = findCol(headers, 'price');
    const statusCol = findCol(headers, 'status');
    const typeCol = findCol(headers, 'type');

    allData.slice(1).forEach(row => {
        financials.totalSubmissions++;
        
        const price = parseFloat(row[priceCol] || '0'); // Safety: Treat empty price as 0
        const status = (row[statusCol] || '').toLowerCase().trim();
        const type = (row[typeCol] || 'Unknown').trim();

        if (!financials.typeStats[type]) {
            financials.typeStats[type] = { priced: 0, unpriced: 0, total: 0 };
        }
        financials.typeStats[type].total++;

        // Only process codes that haven't been marked as 'paid'
        if (status !== 'paid') {
            if (!isNaN(price) && price > 0) {
                financials.totalNetOwed += price;
                financials.typeStats[type].priced++;
            } else {
                financials.unpricedCount++;
                financials.typeStats[type].unpriced++;
            }
        }
    });
    return financials;
};


module.exports = {
    sheets,
    recordUser,
    findUsernameById,
    handleCodeSubmission,
    aggregateUserBatches,
    getBatchDetails,
    getUserDataAsCsv,
    deleteUserData,
    calculateUserFinancials,
};