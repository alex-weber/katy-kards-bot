const Canvas = require('@napi-rs/canvas');
const fs = require('fs')
const host = 'https://www.kards.com'
const { getUser } = require('./db')

/**
 *
 * @param topDeck
 * @returns {Promise<string>}
 */
async function drawBattlefield(topDeck)
{

  const canvas = Canvas.createCanvas(700, 500)
  const context = canvas.getContext('2d')
  const background = await Canvas.loadImage('./assets/td/board.png')
  // This uses the canvas dimensions to stretch the image onto the entire canvas
  context.drawImage(background, 0, 0, canvas.width, canvas.height)
  //draw cards
  const padding = 20
  const paddingTop = 70
  const cardWidth = 250
  const cardHeight = 350
  const card1 = await Canvas.loadImage(host + topDeck.card1.imageURL)
  context.drawImage(card1, padding, paddingTop, cardWidth, cardHeight)
  const card2 = await Canvas.loadImage(host + topDeck.card2.imageURL)
  context.drawImage(card2, canvas.width - cardWidth - padding, paddingTop, cardWidth, cardHeight)
  //draw vs sign
  const vs = await Canvas.loadImage('./assets/td/vs.png')
  context.drawImage(vs, padding + cardWidth, 170, 160, 160)
  //write players names
  context.font = '30px'
  context.fillStyle = '#d2b8b8'
  // Actually fill the text with a solid color
  const user1 = await getUser(topDeck.player1)
  const user2 = await getUser(topDeck.player2)
  context.fillText(user1.name, padding, 40)
  context.fillText(user2.name, 440, 40)
  // Write the image to file
  const buffer = canvas.toBuffer("image/png")
  const file = "./tmp/" +topDeck.id+ ".png"
  fs.writeFileSync(file, buffer)

  return file
}

module.exports = { drawBattlefield }