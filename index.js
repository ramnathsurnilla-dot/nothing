// index.js

// Load secrets from the .env file
require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURATION ---
const token = process.env.TELEGRAM_TOKEN;
const PORT = process.env.PORT || 3000; // Port for the web server

// This is the URL your bot will be hosted on (we'll get this from Railway later)
const webhookUrl = 'https://your-bot-url.up.railway.app'; 

// Initialize the bot
const bot = new TelegramBot(token);

// Set the webhook
bot.setWebHook(`${webhookUrl}/bot${token}`);

// Initialize the web server
const app = express();
app.use(express.json()); // Middleware to parse JSON from Telegram

// This is the endpoint Telegram will send updates to. It replaces doPost(e).
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200); // Send a success response to Telegram
});

// --- BOT LOGIC ---

// Example: A simple /start command handler
// This replaces your handleCommand('/start', ...) logic
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;

  const welcomeText = `👋 *Welcome, @${username}!*\n\nTo begin, please select a code type from the menu below.`;

  // This replaces the keyboard markup in your Apps Script
  const keyboard = {
    keyboard: [['1000 Roblox'], ['800 Roblox'], ['400 Roblox']],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Select a code type to submit"
  };

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

// Add more bot.onText(...) for other commands and bot.on('callback_query', ...) for buttons

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});