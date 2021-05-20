const request = require("request");
const TwitterBot = require("twitter");
const moment = require("moment-timezone");
const express = require("express");
const { MongoClient } = require("mongodb");
const TelegramBot = require('node-telegram-bot-api');

let config = require("./config");

// Setting twitter configuration
let twitter = new TwitterBot(config.twitter);

// Setting telegram configuration
let telegramToken = config.telegram.token;
let telegram = new TelegramBot(telegramToken, { polling: true });

const client = new MongoClient(config.mongodb.url);
let db;

let app = express();
let telegram_msg = [];

let earlyAlertDate = "";        // Keep latest date of early alert message sent

// Get the information if vaccine doses are available
let getVaccineDoses = () => {
    let date = moment(new Date()).tz('Asia/Kolkata');
    let today = date.format('DD-MM-YYYY');      // Today's date

    // Make a request to CoWin server
    request({
        uri: "https://cdn-api.co-vin.in/api/v2/appointment/sessions/calendarByDistrict",
        method: "GET",
        qs: {
            district_id: "360",     // Hoshangabad district ID
            date: today
        }
    }, (error, res, body) => {
        if (error)
            console.log("ERROR:", error);

        else if (body && body != "Unauthenticated access!") {
            let activeSessions = [];

            // Get all sessions with age 18+ and available vaccines
            JSON.parse(body).centers.forEach(center => {
                let filSessions = center.sessions.filter(session => {
                    // if (session.min_age_limit == 18 && session.available_capacity == 0) {
                    if (session.min_age_limit == 18 && session.available_capacity > 0) {
                        session.center = center.name;
                        session.pincode = center.pincode;
                        session.block_name = center.block_name;
                        return session;
                    }
                });

                if (filSessions[0])
                    activeSessions = activeSessions.concat(filSessions);
            });
            console.log("\n", activeSessions);

            // If atleast one session found
            if (activeSessions[0]) {
                console.log("YES, FOUND AN ACTIVE SESSION", date.format('LT'));
                console.log(activeSessions[0].session_id);

                // Inform twitter and telegram users about vaccine availibility
                activeSessions.forEach(s => {
                    if (s.available_capacity > 10)      // Inform twitter only if slots more than 10
                        informTwitter(s);
                    informTelegram(s, date, today);
                });
                // if (earlyAlertDate != today) {
                //     let msg = `A message to Hoshangabadis -\nVaccine availability is updated at nearby place in our district just now. Chances are it can be updated for your place in next few minutes (15-20). So, be ready.\n\nहमारे जिले में पास में ही अभी-अभी टीके की जानकारी उपलब्ध कराई गयी है। संभावना है कि आपके यहां कुछ ही मिनटों (15-20) में अपडेट कराया जा सकता है। तैयार रहें।`;
                //     telegram.sendMessage(config.telegram.channel_id, msg);
                //     earlyAlertDate = today;
                //     console.log("Sending early alert", earlyAlertDate);
                // }
            }
            else {
                console.log("NOT AVAILABLE", date.format('LT'));
            }
        }
        else
            console.log("SOME PROBLEM OCCURRED", error, body);
    });
}

// Get vaccine info in every few seconds
// setInterval(getVaccineDoses, 10000);
setInterval(getVaccineDoses, 3000);

// Informing twitter about vaccine
let informTwitter = (s) => {
    twitter.post('statuses/update', {
        status: `Vaccine alert in ${s.block_name} ${s.pincode}, Hoshangabad district, MP. (18-44 age)\n${s.available_capacity} slots of ${s.vaccine} available at ${s.center} on ${s.date}.\nJoin telegram https://t.me/hbadvaccine to get alerts for #Hoshangabad district, MP #MPFightsCorona #CovidVaccine`
    }, (error, tweet, response) => {
        if (error)
            console.log("TWEET ERROR", error);
        else
            console.log("TWEETED");
    });
}

let bookAppointment = () => {
    request({
        uri: 'https://cdn-api.co-vin.in/api/v2/appointment/schedule',
        method: 'POST',

    })
}

// Informing telegram about vaccine
let informTelegram = (s, date, today) => {
    let msg = `${s.block_name} (${s.pincode})\nCenter: ${s.center}\nSlots available: ${s.available_capacity} of ${s.vaccine}\nDate: ${s.date}\nCoWin: https://selfregistration.cowin.gov.in`;

    // Check if same message is already sent
    if (!telegram_msg.includes(msg)) {
        telegram_msg.push(msg);     // Keep the track of messages so that same message don't sent again

        telegram.sendMessage(config.telegram.channel_id, msg).then(success => console.log("Message sent to telegram"))
            .catch(error => console.log("ERROR while sending message to telegram", error));

        hourlyVaccineCount(s, date, today);     // Update no of vaccines per hour
    }
    else {
        console.log("Already sent this message to telegram");
    }
}

// Update no of vaccines per hour in DB
let hourlyVaccineCount = (s, date, today) => {
    let updateQuery = { "$push": {} };
    updateQuery["$push"][date.format("HH")] = [s.pincode, s.available_capacity];
    db.collection('stats').findOneAndUpdate({ date: today }, updateQuery, { upsert: true }, (err, stats) => console.log("DB Updated"));
}

// Connect to MongoDB
client.connect(err => {
    if (!err) {
        db = client.db(config.mongodb.dbName);
        console.log("Successfully connected to MongoDB.");
    }
});

// Run server
app.listen(5000, () => {
    console.log("App running on port 5000!")
})