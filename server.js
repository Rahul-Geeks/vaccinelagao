const request = require("request");
const TwitterBot = require("twitter");
const moment = require("moment-timezone");
const express = require("express");
const TelegramBot = require('node-telegram-bot-api');

let config = require("./config");

// Setting twitter configuration
let twitter = new TwitterBot(config.twitter);

// Setting telegram configuration
let telegramToken = config.telegram.token;
let telegram = new TelegramBot(telegramToken, { polling: true });

let app = express();
let telegram_msg = [];

// Get the information if vaccine doses are available
let getVaccineDoses = () => {
    let date = moment(new Date()).tz('Asia/Kolkata');
    let today = date.format('DD-MM-YYYY');      // Today's date

    // Make a request to CoWin server
    request({
        uri: "https://cdn-api.co-vin.in/api/v2/appointment/sessions/calendarByPin",
        method: "GET",
        qs: {
            pincode: "461001",
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
                    informTwitter(s.available_capacity, s.center, s.date);
                    informTelegram(s.available_capacity, s.center, s.date);
                });
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
// setInterval(getVaccineDoses, 10000 * 3);
setInterval(getVaccineDoses, 3000);

// Informing twitter about vaccine
let informTwitter = (capacity, centerName, date) => {
    twitter.post('statuses/update', {
        status: `Vaccination slots alert (18-44 age) for Hoshangabad, M.P 461001.
        Center: ${centerName}
        Slots available: ${capacity}
        Date: ${date}
        #CovidIndia #CovidVaccineIndia #Hoshangabad`
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
let informTelegram = (capacity, centerName, date) => {
    let msg = `Vaccination slots alert (18-44 age) for Hoshangabad, M.P 461001.
    Center: ${centerName}
    Slots available: ${capacity}
    Date: ${date}`

    // Check if same message is already sent
    if (!telegram_msg.includes(msg)) {
        telegram_msg.push(msg);     // Keep the track of messages so that same message don't sent again

        telegram.sendMessage(config.telegram.chat_id, msg).then(success => console.log("Message sent to telegram"))
            .catch(error => console.log("ERROR while sending message to telegram", error));
    }
    else {
        console.log("Already sent this message to telegram");
    }
}

// Run server
app.listen(5000, () => {
    console.log("App running on port 5000!")
})