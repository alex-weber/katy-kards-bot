const search = require('./search.js')
const stats = require('./stats.js')
const translator = require("./translator");
/*search.getCards('usa bomber blitz', 'ru').then(res => {
    console.log(search.getCards(res))
})*/

/*try {
    stats.getStats().then(res => {
        console.log(res)
    }).catch(error => {
        console.error(error.code)
    })
} catch (e) {
    console.log(e)
}*/

/*const { Pool, Client } = require('pg')
const connectionString = 'postgresql://postgres:gorbunok09@localhost:5432/kartonki'
const pool = new Pool({
    connectionString,
})
pool.query('SELECT * FROM public.card LIMIT 1', (err, res) => {
    console.log(err, res.rows)
    pool.end()
})*/

/*let variables = {
    "language": 'en',
    "q": 'destruction',
    "showSpawnables": true,
}

search.getCards(variables).then(res => {
    if (!res) {
        console.log('no res');
    }
    else {
        const cards = res.data.data.cards.edges
        const counter = res.data.data.cards.pageInfo.count

        const files = search.getFiles(cards, 10)
        console.log(counter, files)
    }
})*/


const limit = "5" || 10
console.log(limit+1)



