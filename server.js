const request = require("request");
const TwitterBot = require("twitter");
const moment = require("moment-timezone");
const express = require("express");
const { MongoClient } = require("mongodb");
const nodemailer = require("nodemailer");
const TelegramBot = require('node-telegram-bot-api');
const crypto = require("crypto");

let config = require("./config");

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
        uri: "https://cdn-api.co-vin.in/api/v2/appointment/sessions/public/calendarByDistrict",
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

            try {
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

                // If atleast one session found
                if (activeSessions[0]) {
                    console.log("YES, FOUND AN ACTIVE SESSION", date.format('LT'));
                    console.log(activeSessions[0].session_id);

                    // let emailHTML = '';

                    // Inform twitter, telegram and email users about vaccine availibility
                    activeSessions.forEach(s => {
                        if (s.available_capacity > 50) {      // Inform twitter only if slots more than 50
                            if (twitterInformed[`${s.pincode}`] != today) {
                                informTwitter(s);
                                twitterInformed[`${s.pincode}`] = today;
                            }
                            else
                                console.log("ALREADY TWEETED FOR THIS PINCODE TODAY");

                            // Set email HTML message
                            // emailHTML = emailHTML + `<b>Center</b>: ${s.center}<br><b>Pincode</b>: ${s.pincode}<br><b>Total slots</b>: ${s.available_capacity} (<b>Dose 1</b>: ${s.available_capacity_dose1} & <b>Dose 2</b>: ${s.available_capacity_dose2}) of ${s.vaccine}<br><b>Date</b>: ${s.date}<br><br>`;
                        }
                        informTelegram(s, date, today);
                    });

                    // Inform on Email
                    // if (emailHTML && emailHTML != '')
                    //     sendMail(emailHTML);

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
            catch (error) {
                console.log("ERROR IN GETVACCINEDOSES METHOD", error, body);
            }
        }
        else
            console.log("SOME PROBLEM OCCURRED", error, body);
    });
}

// Get vaccine info in every few seconds
setInterval(getVaccineDoses, 3000);
// getVaccineDoses();

// Informing twitter about vaccine
let informTwitter = (s) => {
    twitter.post('statuses/update', {
        status: `Vaccine alert in ${s.block_name} ${s.pincode}\nTotal slots: ${s.available_capacity} (Dose 1: ${s.available_capacity_dose1} & Dose 2: ${s.available_capacity_dose2}) slots of ${s.vaccine} available at ${s.center} on ${s.date}.\nJoin telegram https://t.me/hbadvaccine to get alerts for #Hoshangabad district, MP #MPFightsCorona #CovidVaccine`
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
    let msg = `${s.block_name} (${s.pincode})\nCenter: ${s.center}\nTotal slots: ${s.available_capacity} of ${s.vaccine}\n(Dose 1: ${s.available_capacity_dose1} & Dose 2: ${s.available_capacity_dose2})\nDate: ${s.date}\nCoWin: https://selfregistration.cowin.gov.in`;

    // Add if Dose 1/2/both available in alert message
    if (s.available_capacity_dose1 && s.available_capacity_dose2)
        msg = 'Dose 1 & 2\n' + msg;
    else if (s.available_capacity_dose1)
        msg = 'Dose 1 only\n' + msg;
    else
        msg = 'Dose 2 only\n' + msg;

    // Check if same message is already sent
    if (!messages.includes(msg)) {
        messages.push(msg);     // Keep the track of messages so that same message don't sent again

        telegram.sendMessage(config.telegram.channel_id, msg).then(success => console.log("Message sent to telegram"))
            .catch(error => console.log("ERROR while sending message to telegram"));

        storeVaccineAlerts(s, date, today);     // Update no of vaccines per hour
    }
    else {
        console.log("Already sent this message to telegram");
    }
}

/**
 * Send email notifications to users
 * @param {string} emailHTML 
 */
let sendMail = (emailHTML) => {
    try {
        db.collection("users").find({}, { email: 1 }).toArray((error, users) => {               // Get user details from DB
            if (error)
                console.log("Error while getting user details to sent email vaccine alert");
            else {
                emailHTML = '<h1>Vaccination slots alert (18-44 age) for Hoshangabad district, M.P.</h1><br>' + emailHTML;

                users.forEach(user => {                         // Send email to all users

                    let hash = genEmailHash(user.email);        // Generate Email hash

                    // Design Email message
                    let msgHTML = emailHTML + `CoWin: https://selfregistration.cowin.gov.in <br>Join Telegram Channel to get instant alerts: <a href="https://t.me/hbadvaccine">HBad Vaccine Alerts</a><br><br><a href="http://${config.server.host}:5000/unsubscribe?email=${user.email}&&hash=${hash}">Unsubscribe</a>`;

                    // Send mail
                    transport.sendMail({
                        from: '"Rahul Chouhan" <rahul.testing12@gmail.com>',    // sender address
                        to: JSON.stringify(user.email),                         // list of receivers
                        subject: "Vaccination Alert",                           // Subject line
                        html: msgHTML,                                          // html body
                    }, (error, result) => console.log("ERROR", error, "EMAIL SENT TO", result.accepted));
                });
            }
        });
    }
    catch (error) {
        console.log("ERROR WHILE UNSUBSCRIBE", error);
    }
}

/**
 * Update no of vaccines per hour in DB
 * @param {object} s Session object
 * @param {Date} date Today's date
 * @param {string} today Formatted date
 */
let storeVaccineAlerts = (s, date, today) => {
    try {
        let updateQuery = {
            $push: {
                details: {
                    pincode: s.pincode,
                    time: new Date(),
                    appointment_date: s.date,
                    available_capacity: s.available_capacity,
                    vaccine: s.vaccine,
                    available_capacity_dose1: s.available_capacity_dose1,
                    available_capacity_dose2: s.available_capacity_dose2,
                    center: s.center
                }
            }
        }
        db.collection('stats').findOneAndUpdate({ date: today }, updateQuery, { upsert: true }, (err, stats) => console.log("DB Updated"));
    }
    catch (error) {
        console.log("ERROR WHILE UNSUBSCRIBE", error);
    }
}

/**
 * Get encrypted email hash
 * @param {string} email User email
 * @returns Encrypted string
 */
let genEmailHash = (email) => crypto.createHmac('sha256', config.email.secret).update(email).digest('hex');

// Connect to MongoDB
client.connect(err => {
    if (!err) {
        db = client.db(config.mongodb.dbName);
        console.log("Successfully connected to MongoDB.");
    }
    else
        console.log("ERROR WHILE CONNECTING TO MONGODB", err);
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
    else {                        // Store user
        try {
            // Add user
            db.collection("users").findOneAndUpdate({ email: req.body.email }, { "$set": req.body }, { upsert: true }, (error, response) => {
                if (error)
                    res.status(500).json({ message: 'Error while storing Email-ID', error: error });
                else
                    res.status(200).json(true);
            });
        }
        catch (error) {
            console.log("ERROR WHILE UNSUBSCRIBE", error);
            res.status(500).json({ message: 'Some error occurred' });
        }
    }
});

// Render index.html when requested a home page
app.get("/", (req, res) => res.render("index.html"));

// Render unsubscribe.html when requested for unsubscribe page
app.get("/unsubscribe", (req, res) => res.render("unsubscribe.html"));

// Delete user details
app.delete("/unsubscribe", (req, res) => {
    if (req.body.email && req.body.hash) {                  // Check if params exists
        let genHash = genEmailHash(req.body.email);         // Generate hash with email

        if (genHash == req.body.hash) {                     // Verify email
            try {
                db.collection("users").deleteOne({ email: req.body.email }, (error, result) => {        // Delete user details
                    if (!error && result.deletedCount == 1)
                        res.status(200).json(true);
                    else {
                        console.log("Some error occurred", error);
                        res.status(500).json({ message: 'Some error occurred' });
                    }
                });
            }
            catch (error) {
                console.log("ERROR WHILE UNSUBSCRIBE", error);
                res.status(500).json({ message: 'Some error occurred' });
            }
        } else
            res.status(404).json(false);
    } else
        res.status(404).json({ message: 'Email ID is not sent' });
});

// Run server
app.listen(5000, () => {
    console.log("App running on port 5000!")
});