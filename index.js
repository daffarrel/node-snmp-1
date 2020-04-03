#!/usr/bin/node
process.env.NTBA_FIX_319 = 1

// EXAMPLE COMMAND:
// /usr/bin/snmpwalk -t '1' -r '3' -v2c -c n3wt3lco -Pud -OQUsn -M /mnt/data/observium/mibs/rfc:/mnt/data/observium/mibs/net-snmp 'udp':'172.16.60.73':'161' .1.3.6.1.4.1.17095.6

require('dotenv').config()
const snmp = require('snmp-native')
const TelegramBot = require('node-telegram-bot-api')
const Intl = require('intl')
const storage = require('node-persist')
const nodemailer = require('nodemailer')
storage.init()

const interval = setInterval(() => {

  // Contacts
  const session = new snmp.Session({
    host: process.env.TARGET_HOST,
    community: process.env.TARGET_COMMUNITY
  })
  const contactStatus = []
  session.getSubtree({ oid: [1, 3, 6, 1, 4, 1, 17095, 6] }, function (
    error,
    varbinds
  ) {
    if (error) {
      console.log(`Fail - ${error}`)
    } else {
      for (let i = 0; i < varbinds.length; i += 3) {
        const vb1 = varbinds[i]
        const vb2 = varbinds[i + 1]

        if (!vb1.value.includes('Undefine') || !vb2.value.includes('Undefine')) {
          const sensorName = vb1.value
          const sensorValue = vb2.value

          storage
            .getItem(sensorName)
            .then(previousValue => {
              if (sensorValue !== previousValue) {
                console.log(
                  sensorName,
                  previousValue,
                  sensorValue,
                  new Date().toLocaleString()
                )
                alertUser(sensorName, sensorValue)
              }
              contactStatus.push({ name: sensorName, value: sensorValue })
              // console.log(sensorName, sensorValue)
              storage.setItem(sensorName, sensorValue)
            })
            .catch(err => console.error(err))
        }
      }
    }
    session.close()
  })

  // Temperature
  // .1.3.6.1.4.1.17095.1000.1.3.0 = "23.74"

  const sessionTemp = new snmp.Session({
    host: process.env.TARGET_HOST,
    community: process.env.TARGET_COMMUNITY
  })
  sessionTemp.get({ oid: [1, 3, 6, 1, 4, 1, 17095, 1000, 1, 3, 0] }, function (
    error,
    varbind
  ) {
    if (error) {
      console.log(`Fail - ${error}`)
    } else {
      const temp = varbind[0].value
      if (temp && temp > 26) {
        console.log(`Temp Alert - ${temp}`)

        storage
          .getItem('b01003-temp')
          .then(previousValue => {
            if (previousValue !== 'alert') {
              alertUser('B01.003 Temp ALERT', temp)
              console.log('Temp - Alert')
              storage.setItem('b01003-temp', 'alert')
            }
          })
      } else {
        storage
          .getItem('b01003-temp')
          .then(previousValue => {
            if (previousValue === 'alert') {
              alertUser('B01.003 Temp Normalize', temp)
              storage.setItem('b01003-temp', 'normal')
              console.log('Temp - Return to Normal')
            }
          })
      }
    }
    sessionTemp.close()
  })
}, 5000);

const alertUser = (name, value) => {
  const token = process.env.TELEGRAM_TOKEN // Newtelco Alert Bot
  const chatIds = [
    process.env.TELEGRAM_CHAT1, // gbormet
    process.env.TELEGRAM_CHAT2 // ndomino
  ]

  const bot = new TelegramBot(token, { polling: false })
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PW
    }
  })

  const notify = (message, json) => {
    chatIds.forEach(chatId => {
      const df = new Intl.DateTimeFormat('de-DE', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric'
      })
      const dateDE = df.format(new Date())
      try {
        // Telegram
        bot.sendMessage(
          chatId,
          `<b>${name}</b> has become <b>${value}</b> at ${dateDE}`,
          {
            parse_mode: 'html'
          }
        )
        // Email (SMTP)
        const message = {
          from: 'alert@newtelco.de',
          to: 'gbormet@newtelco.de',
          cc: 'mleidemer@newtelco.de',
          subject: `ALERT ${name} - ${value}`,
          text: `Your sensor ${name} has changed to ${value} at ${dateDE}`
        }
        transport.sendMail(message, function (err, info) {
          if (err) {
            console.log(err)
          } else {
            // Success!
            // console.log(info)
          }
        })
      } catch (err) {
        console.log(
          'Something went wrong when trying to send a Telegram notification',
          err
        )
      }
    })
  }
  notify()
}
