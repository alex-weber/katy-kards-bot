const {myTDRank, topDeck} = require("../topDeck")
const {getUser} = require('../db')
const {drawBattlefield} = require("../canvasManager")
const fs = require("fs")

test('playing TD', async () => {

    console.log('starting top deck game')
    let user1 = await getUser('1')
    await topDeck('1', user1)
    let user2 = await getUser('2')
    let td = await topDeck('1', user2)
    try {
        const battleImage = await drawBattlefield(td)
        console.log(td.log)
        //delete the battle image
        await fs.rm(battleImage, () => {})
    } catch (e) {
        console.error(e.toString())
    }
    expect(td.state).toEqual('finished')


}, 10000)

test('My TD Rank', async () => {
    let user = await getUser('2')
    let rank = myTDRank(user)
    console.log(rank)
    expect(rank).toMatch('Games')
})