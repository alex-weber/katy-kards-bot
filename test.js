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

let variables = {
    "language": 'ru',
    "q": 'охват',
    "showSpawnables": true,
}

search.getCards(variables).then(res => {
    const cards = res.data.data.cards.edges

    const files = search.getFiles(cards, 3)
    console.log(files)
})




