const Canvas = require('@napi-rs/canvas')
const fs = require('fs')
const host = 'https://www.kards.com'
const {getUser} = require('./db')

/**
 *
 * @param topDeck
 * @returns {Promise<string>}
 */
async function drawBattlefield(topDeck)
{
    const canvas = Canvas.createCanvas(700, 500)
    const context = canvas.getContext('2d')
    const backgroundPromise = Canvas.loadImage('./assets/td/board.png')
    const vsPromise = Canvas.loadImage('./assets/td/vs.png')
    const card1Promise = Canvas.loadImage(host + topDeck.card1.imageURL)
    const card2Promise = Canvas.loadImage(host + topDeck.card2.imageURL)
    const [
        background,
        vs,
        card1,
        card2
    ] = await Promise.all([
            backgroundPromise,
            vsPromise,
            card1Promise,
            card2Promise
    ])
    // This uses the canvas dimensions to stretch the image onto the entire canvas
    context.drawImage(background, 0, 0, canvas.width, canvas.height)
    //draw cards
    const padding = 20
    const paddingTop = 70
    const cardWidth = 250
    const cardHeight = 350
    context.drawImage(card1, padding, paddingTop, cardWidth, cardHeight)
    context.drawImage(card2, canvas.width - cardWidth - padding, paddingTop, cardWidth, cardHeight)
    //draw the VS sign
    context.drawImage(vs, padding + cardWidth, 170, 160, 160)
    //write players names
    context.font = '30px'
    context.fillStyle = '#d2b8b8'
    const user1Promise = getUser(topDeck.player1)
    const user2Promise = getUser(topDeck.player2)
    const [user1, user2] = await Promise.all([user1Promise, user2Promise])
    context.fillText(user1.name, padding, 40)
    context.fillText(user2.name, 440, 40)
    // Write the image to file
    const buffer = canvas.toBuffer("image/png")
    const file = "./tmp/" + topDeck.id + ".png"
    fs.writeFileSync(file, buffer)

    return file
}

module.exports = {drawBattlefield}