const request = require("request");
const TwitterBot = require("twitter");
const moment = require("moment-timezone");
const express = require("express");
const { MongoClient } = require("mongodb");
const nodemailer = require("nodemailer");
const TelegramBot = require('node-telegram-bot-api');

let config = require("./config");
let data = require("./data.json");

// Setting twitter configuration
let twitter = new TwitterBot(config.twitter);

// Setting telegram configuration
let telegramToken = config.telegram.token;
let telegram = new TelegramBot(telegramToken, { polling: true });

const client = new MongoClient(config.mongodb.url);
let db;

let app = express();
let messages = [];      // Keep telegram & Email messages here

// Create a transporter to send the mail
let transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    auth: {
        user: config.email.user,
        pass: config.email.pwd
    }
});

let earlyAlertDate = "";        // Keep latest date of early alert message sent
let twitterInformed = {};       // Keep daily info about informing twitter

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

                // Inform twitter, telegram and email users about vaccine availibility
                activeSessions.forEach(s => {
                    if (s.available_capacity > 50 && twitterInformed[`${s.pincode}`] != today) {      // Inform twitter only if slots more than 50
                        informTwitter(s);
                        twitterInformed[`${s.pincode}`] = today;
                    }
                    informTelegram(s, date, today);
                    sendMail(s.available_capacity, s.center, s.date);
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
        status: `Vaccine alert in ${s.block_name} ${s.pincode}\n${s.available_capacity} slots of ${s.vaccine} available at ${s.center} on ${s.date}.\nJoin telegram https://t.me/hbadvaccine to get alerts for #Hoshangabad district, MP #MPFightsCorona #CovidVaccine`
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
    if (!messages.includes(msg)) {
        messages.push(msg);     // Keep the track of messages so that same message don't sent again

        telegram.sendMessage(config.telegram.channel_id, msg).then(success => console.log("Message sent to telegram"))
            .catch(error => console.log("ERROR while sending message to telegram", error));

        hourlyVaccineCount(s, date, today);     // Update no of vaccines per hour
    }
    else {
        console.log("Already sent this message to telegram");
    }
}

// Send email notifications to users
let sendMail = (capacity, centerName, date) => {

    // HTML message
    let msgHTML = `<h1>Vaccination slots alert (18-44 age) for Hoshangabad, M.P 461001.</h1><br>
    Center: ${centerName}<br>
    Slots available: ${capacity}<br>
    Date: ${date}<br>
    CoWin: https://selfregistration.cowin.gov.in`;

    // Check if same email messsage is not already sent
    if (!messages.includes(msgHTML)) {
        messages.push(msgHTML);     // Add message to the message list

        // Send mail
        transport.sendMail({
            from: '"Rahul Chouhan" <rahul.testing12@gmail.com>', // sender address
            to: JSON.stringify(data.user_emails), // list of receivers
            subject: "Vaccination Alert", // Subject line
            html: msgHTML, // html body
        }, (error, result) => console.log("ERROR", error, "EMAIL SENT TO", result.accepted));
    }
    else {
        console.log("Already sent this message to Email");
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

// Aceept request for given headers
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.set('views', __dirname);
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');

app.use(express.json());

// Create user document with email ID
app.post("/email", (req, res) => {
    if (!req.body.email)        // If no email sent
        res.status(404).json({ message: 'Send Email' });
    else if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(req.body.email))      // If invalid email sent
        res.status(404).json({ message: 'Enter valid email address' });
    else                        // Store user
        db.collection("users").findOneAndUpdate({ email: req.body.email }, { "$set": req.body }, { upsert: true }, (error, response) => {
            if (error)
                res.status(500).json({ message: 'Error while storing Email-ID', error: error });
            else
                res.status(200).json(true);
        });
});

// Render index.html when requested a home page
app.get("/", (req, res) => {
    res.render("index.html");
});

// Run server
app.listen(5000, () => {
    console.log("App running on port 5000!")
})