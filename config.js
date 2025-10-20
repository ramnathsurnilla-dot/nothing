// config.js

module.exports = {
    // User Roles
    adminUsername: process.env.ADMIN_USERNAME,
    adminChatId: process.env.ADMIN_CHAT_ID,
    specialUserUsernames: ['@Faiyaz_ali777', '@sayed_kira'],

    // Financials
    MINIMUM_PAYOUT_AMOUNT: 50.00,

    // Code Types
    CODE_TYPES_ALL_USERS: ['1000 Roblox', '800 Roblox', '400 Roblox', 'lol 575', 'ow 1k'],
    CODE_TYPES_SPECIAL_USERS: [
        'minecoin 330', 'lol 575', 'pc game pass', 'lol 100', 'ow 200',
    ],
    
    // This combines all valid types into one array for easy checking
    get VALID_CODE_TYPES() {
        return [...new Set([...this.CODE_TYPES_ALL_USERS, ...this.CODE_TYPES_SPECIAL_USERS])];
    },

    // Validation
    CODE_PATTERN_REGEX: /^[a-zA-Z0-9-]{5,}$/,

    // Spreadsheet Headers
    SHEET_HEADERS: ["Code", "Type", "Timestamp", "Price", "Batch ID", "Status", "Note"],
};