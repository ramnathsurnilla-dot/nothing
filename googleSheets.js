// googleSheets.js

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// --- CONFIGURATION ---
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_HEADERS = ["Code", "Type", "Timestamp", "Price", "Batch ID", "Status", "Note"];
let userMapCache = null; // In-memory cache for the user map

// --- AUTHENTICATION ---
// This function authenticates with the Google Sheets API
const getSheetsClient = () => {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
        const auth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        return google.sheets({ version: 'v4', auth });
    } catch (error) {
        console.error("CRITICAL: Failed to parse GOOGLE_CREDENTIALS. Make sure it's set correctly in your environment variables.", error);
        return null;
    }
};

const sheets = getSheetsClient();
if (!sheets) {
    console.error("Could not initialize Google Sheets client. The bot will not be able to interact with the spreadsheet.");
}

// --- CORE UTILITIES ---

/**
 * Ensures a sheet with the given title exists, creating it if it doesn't.
 * @param {string} title The name of the sheet.
 * @param {string[]} headers An array of headers to set if the sheet is new.
 * @returns {Promise<boolean>} True if the sheet exists or was created.
 */
async function ensureSheetExists(title, headers) {
    if (!sheets) return false;
    try {
        const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetExists = spreadsheetInfo.data.sheets.some(s => s.properties.title === title);

        if (!sheetExists) {
            console.log(`Sheet "${title}" not found, creating it...`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [{ addSheet: { properties: { title } } }],
                },
            });
            // Add headers to the new sheet
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${title}!A1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [headers] },
            });
        }
        return true;
    } catch (error) {
        console.error(`Error ensuring sheet "${title}" exists:`, error);
        return false;
    }
}


// --- USER MANAGEMENT ---

/**
 * Fetches all users from the '_users' sheet and caches them.
 * @returns {Promise<{byId: {}, byUsername: {}}>} A map of users.
 */
async function getUsers() {
    if (userMapCache) return userMapCache;
    if (!sheets) return { byId: {}, byUsername: {} };
    
    await ensureSheetExists('_users', ['UserID', 'Username']);

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: '_users!A2:B',
        });

        const userMap = { byId: {}, byUsername: {} };
        const rows = response.data.values || [];
        rows.forEach(row => {
            if (row[0] && row[1]) {
                const id = row[0].toString();
                const username = row[1].toString();
                userMap.byId[id] = username;
                userMap.byUsername[username.toLowerCase()] = id;
            }
        });
        userMapCache = userMap;
        return userMap;
    } catch (error) {
        console.error("Error fetching users:", error);
        return { byId: {}, byUsername: {} };
    }
}

/**
 * Records a user in the '_users' sheet if they don't exist.
 * @param {number} userId The user's Telegram ID.
 * @param {string} username The user's Telegram username.
 */
async function recordUser(userId, username) {
    if (!sheets) return;
    const users = await getUsers();
    const userIdStr = userId.toString();
    const currentUsername = users.byId[userIdStr];

    if (!currentUsername) {
        console.log(`New user found: ${username} (${userId}). Adding to _users sheet.`);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: '_users!A:B',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[userIdStr, username]],
            },
        });
        userMapCache = null; // Invalidate cache
    }
    // You can add logic here to handle username changes if needed
}

/**
 * Finds a username by their Telegram ID.
 * @param {number} userId The user's Telegram ID.
 * @returns {Promise<string|null>} The username or null if not found.
 */
async function findUsernameById(userId) {
    const users = await getUsers();
    return users.byId[String(userId)] || null;
}

// --- MAIN BOT LOGIC ---

/**
 * Handles the submission of new codes from a user.
 * @param {number} userId
 * @param {string} username
 * @param {string} codeType
 * @param {string[]} codes
 * @returns {Promise<{acceptedCount: number, duplicateCodes: string[], invalidFormatCodes: string[]}>}
 */
async function handleCodeSubmission(userId, username, codeType, codes) {
    if (!sheets) throw new Error("Database connection is not available.");

    await ensureSheetExists(username, SHEET_HEADERS);
    
    // 1. Get all existing codes for the user to check for duplicates
    let existingCodes = new Set();
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${username}!A2:A`,
        });
        if (response.data.values) {
            response.data.values.forEach(row => existingCodes.add(row[0]));
        }
    } catch (error) {
        // This error often happens if the sheet is empty, which is fine.
        if (error.code !== 400) console.error("Error fetching existing codes:", error);
    }
    
    // 2. Validate and sort codes
    const CODE_PATTERN_REGEX = /^[a-zA-Z0-9-]{5,}$/;
    const uniqueNewCodes = [];
    const duplicateCodes = [];
    const invalidFormatCodes = [];

    const submittedCodes = new Set(codes); // Remove duplicates from the submission itself

    submittedCodes.forEach(code => {
        if (!CODE_PATTERN_REGEX.test(code)) {
            invalidFormatCodes.push(code);
        } else if (existingCodes.has(code)) {
            duplicateCodes.push(code);
        } else {
            uniqueNewCodes.push(code);
        }
    });

    // 3. Add the valid new codes to the sheet
    if (uniqueNewCodes.length > 0) {
        const timestamp = new Date().toLocaleDateString('en-US'); // MM/DD/YYYY
        const batchId = new Date().getTime();

        const newRows = uniqueNewCodes.map(code => [
            code, codeType, timestamp, "", batchId, "Pending", ""
        ]);
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${username}!A:G`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: newRows },
        });
    }

    return {
        acceptedCount: uniqueNewCodes.length,
        duplicateCodes,
        invalidFormatCodes
    };
}


/**
 * Calculates financial statistics for a given user.
 * @param {number} userId
 * @returns {Promise<object>}
 */
async function calculateUserFinancials(userId) {
    const username = await findUsernameById(userId);
    if (!username || !sheets) {
        return { totalNetOwed: 0, unpricedCount: 0, estimatedValue: 0, totalEstimatedBalance: 0 };
    }

    const financials = {
        totalOwed: 0,
        unpricedCount: 0,
    };
    
    try {
        await ensureSheetExists(username, SHEET_HEADERS);
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${username}!A2:G`, // Get all columns
        });

        const rows = response.data.values || [];
        // Assuming headers are: Code, Type, Timestamp, Price, Batch ID, Status, Note
        const PRICE_COL_INDEX = 3; 
        const STATUS_COL_INDEX = 5;

        for (const row of rows) {
            const price = parseFloat(row[PRICE_COL_INDEX]);
            const status = (row[STATUS_COL_INDEX] || '').toLowerCase();
            
            if (status !== 'paid') {
                if (!isNaN(price) && price > 0) {
                    financials.totalOwed += price;
                } else {
                    financials.unpricedCount++;
                }
            }
        }
    } catch (error) {
        if (error.code !== 400) console.error(`Error calculating financials for ${username}:`, error);
    }
    
    // Note: The logic for totalPaid and estimated value would need to be added here
    // For simplicity, this version focuses on what's available in the user's sheet
    
    return {
        totalNetOwed: financials.totalOwed, // This is simplified, assumes no payments logged yet
        unpricedCount: financials.unpricedCount,
        estimatedValue: 0, // Placeholder
        totalEstimatedBalance: financials.totalOwed, // Placeholder
    };
}


module.exports = {
    recordUser,
    findUsernameById,
    handleCodeSubmission,
    calculateUserFinancials,
};