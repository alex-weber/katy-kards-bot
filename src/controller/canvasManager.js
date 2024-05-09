const Canvas = require('@napi-rs/canvas')
const fs = require('fs')
const host = 'https://www.kards.com'
const {getUser} = require('../database/db')

/**
 *
 * @param topDeck
 * @returns {Promise<string>}
 */
async function drawBattlefield(topDeck)
{
    let canvas = Canvas.createCanvas(700, 500)
    const context = canvas.getContext('2d')
    const backgroundPromise = Canvas.loadImage('./src/assets/td/board.png')
    const vsPromise = Canvas.loadImage('./src/assets/td/vs.png')
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
    context.font = '25px "Arial" bold'
    context.fillStyle = '#d3cccc'
    const user1Promise = getUser(topDeck.player1)
    const user2Promise = getUser(topDeck.player2)
    const [user1, user2] = await Promise.all([user1Promise, user2Promise])
    context.fillText(user1.name, padding, 40)
    context.fillText(user2.name, 430, 40)
    console.log(user1, user2)
    // Write the image to file
    let buffer = canvas.toBuffer("image/png")
    const file = "./src/tmp/" + topDeck.id + ".png"
    fs.writeFileSync(file, buffer)
    //trying to fix memory leak
    buffer = null
    canvas = null

    return file
}

module.exports = {drawBattlefield}