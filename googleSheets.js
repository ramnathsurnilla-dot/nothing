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
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheets = google.sheets({ version: 'v4', auth });
} catch (error) {
    console.error("CRITICAL: Failed to parse GOOGLE_CREDENTIALS.", error.message);
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
let userMapCache = null;

// --- UTILITIES ---
const getHeaders = (data) => data[0]?.map(h => h.toLowerCase().trim()) || [];
const findCol = (headers, name) => headers.indexOf(name);

const ensureSheetExists = async (title) => {
    if (!sheets) return false;
    try {
        const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetExists = spreadsheetInfo.data.sheets.some(s => s.properties.title === title);
        if (!sheetExists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: { requests: [{ addSheet: { properties: { title } } }] },
            });
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
    if (!sheets) return [];
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:G`,
        });
        return response.data.values || [];
    } catch (error) {
        if (error.code !== 400) console.error(`Error getting data from sheet "${sheetName}":`, error.message);
        return [];
    }
};


// --- USER MANAGEMENT ---
const getUsers = async () => {
    if (userMapCache) return userMapCache;
    await ensureSheetExists('_users');
    const rows = await getSheetData('_users');
    const userMap = { byId: {}, byUsername: {} };
    if (rows.length > 1) {
        rows.slice(1).forEach(row => {
            if (row[0] && row[1]) {
                const [id, username] = row;
                userMap.byId[id.toString()] = username.toString();
                userMap.byUsername[username.toString().toLowerCase()] = id.toString();
            }
        });
    }
    userMapCache = userMap;
    return userMap;
};

const recordUser = async (userId, username) => {
    const users = await getUsers();
    if (!users.byId[String(userId)]) {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: '_users!A:B',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[String(userId), username]] },
        });
        userMapCache = null;
    }
};

const findUsernameById = async (userId) => {
    const users = await getUsers();
    return users.byId[String(userId)] || null;
};

const deleteUserData = async (username) => {
    await ensureSheetExists(username);
    const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheet = spreadsheetInfo.data.sheets.find(s => s.properties.title === username);
    if (sheet) {
        const sheetId = sheet.properties.sheetId;
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests: [{ deleteSheet: { sheetId } }] }
        });
    }
    // Note: User is not removed from _users sheet, only their data sheet.
};

// --- DATA OPERATIONS ---
const handleCodeSubmission = async (username, codeType, codes) => {
    await ensureSheetExists(username);
    const allData = await getSheetData(username);
    const existingCodes = new Set(allData.slice(1).map(row => row[0]));

    const uniqueNewCodes = [];
    const duplicateCodes = [];
    const invalidFormatCodes = [];
    const submittedCodes = new Set(codes);

    submittedCodes.forEach(code => {
        if (!config.CODE_PATTERN_REGEX.test(code)) invalidFormatCodes.push(code);
        else if (existingCodes.has(code)) duplicateCodes.push(code);
        else uniqueNewCodes.push(code);
    });

    if (uniqueNewCodes.length > 0) {
        const timestamp = new Date().toLocaleDateString('en-US');
        const batchId = new Date().getTime();
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
        const batchId = row[batchIdCol];
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
        if (batch.statusCounts['Pending']) batch.status = 'Pending';
        else if (batch.statusCounts['Listed']) batch.status = 'Listed';
        else if (batch.statusCounts['Paid'] && batch.statusCounts['Paid'] === batch.count) batch.status = 'Paid';
        else batch.status = 'Partially Paid';
        else batch.status = 'Processed';
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
    const details = { codes: [], type: '', status: 'Unknown', count: 0 };
    const statusCounts = {};

    allData.slice(1).forEach(row => {
        if (String(row[batchIdCol]) === String(batchId)) {
            details.codes.push(row[codeCol]);
            details.type = row[typeCol];
            const status = (row[statusCol] || 'Pending').trim();
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
    });
    
    details.count = details.codes.length;
    if (details.count === 0) return null;

    if (statusCounts['Pending']) details.status = 'Pending';
    else if (statusCounts['Listed']) details.status = 'Listed';
    else details.status = 'Processed';

    return details;
};

const getUserDataAsCsv = async (username) => {
    const allData = await getSheetData(username);
    if (allData.length <= 1) return null;
    return allData.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
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
        const price = parseFloat(row[priceCol]);
        const status = (row[statusCol] || '').toLowerCase();
        const type = row[typeCol] || 'Unknown';

        if (!financials.typeStats[type]) {
            financials.typeStats[type] = { priced: 0, unpriced: 0, total: 0 };
        }
        financials.typeStats[type].total++;

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
    // Note: totalWithdrawn would need to be calculated from a separate _payments_log sheet
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