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
    },
    mongodb: {
        url: process.env.MONGODB_URL,
        dbName: process.env.DB_NAME
    },
    email: {
        user: process.env.EMAIL_ID,
        pwd: process.env.EMAIL_PWD,
        secret: process.env.EMAIL_SECRET
    },
    server: {
        host: process.env.SERVER_HOST
    }
};