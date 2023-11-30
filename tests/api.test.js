const {getStats} = require('../stats')
const {getCards, getFiles, listSynonyms} = require('../search')
const {getUser} = require('../db')

test('player stats loaded', async () => {
    const data = await getStats('en')
    expect(data).toMatch(/Time/)
})

test('search is working', async () => {
    let variables = {
        language: 'en',
        q: 'Leopold',
        showSpawnables: true,
        showReserved: true,
        offset: 20,
    }
    let data = await getCards(variables)
    expect(data.cards[0].node.cardId).toMatch('leopold')
    variables.q = 'sov tank 10k'
    data = await getCards(variables)
    const files = getFiles(data, 'en', 10)
    expect(files[0].attachment).toMatch('stalin')
})

test('listing synonyms', async () => {
    const user = await getUser('1')
    const data = await listSynonyms(user, 'listsyn')
    expect(data).toBeTruthy()
})

test('listing synonyms no admin rejection', async () => {
    const user = await getUser('2')
    const data = await listSynonyms(user, 'listsyn')
    expect(data).toBeNull()
})