require("dotenv").config();

module.exports = {
    twitter: {
        consumer_key: process.env.TWITTER_CONSUMER_KEY,
        consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
        access_token_key: process.env.TWITTER_TOKEN_KEY,
        access_token_secret: process.env.TWITTER_TOKEN_SECRET,
    },
    telegram: {
        token: process.env.TELEGRAM_TOKEN,
        channel_id: process.env.TELEGRAM_CHANNEL_ID
    }
};