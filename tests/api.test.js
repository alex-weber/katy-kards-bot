const {getStats} = require('../src/tools/stats')
const {getCards, getFiles, listSynonyms} = require('../src/tools/search')
const {getUser} = require('../src/database/db')

test('player stats loaded', async () => {
    const data = await getStats('en')
    expect(data).toMatch(/Time/)
})

test('search is working', async () => {
    let variables = {
        language: 'en-EN',
        q: 'leo',
        showSpawnables: true,
        showReserved: true,
    }
    let data = await getCards(variables)
    expect(data.cards[0].node.cardId).toMatch('leopold')
    variables.q = 'sov tank 10k'
    data = await getCards(variables)
    let files = getFiles(data, 'en', 10)
    expect(files[0].attachment).toMatch('iosef_stalin_ii')
    variables.q = 'совет танк 10к'
    data = await getCards(variables)
    files = getFiles(data, 'en', 10)
    expect(files[0].attachment).toMatch('iosef_stalin_ii')
})

test('listing synonyms', async () => {
    const data = await listSynonyms('commands')
    expect(data).toBeTruthy()
})