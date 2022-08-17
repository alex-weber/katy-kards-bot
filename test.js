
const {
    getUser,
    updateUser,
    createMessage,
    getMessages,
    getSynonym,
    createSynonym,
    createCard,
    cardExists,
} = require('./db')
const search = require("./search");
const { searchLanguages }= require('./language.js')
const {languages} = require("./language");



async function slave() {
    let variables = {}
    variables.q = 'inf 0c 3k'
    let result = await search.advancedSearch(variables)
    console.log(result)
}


slave().catch((e) => {throw e}).finally(async () =>
    {
        console.log('Promise finalized')
    })

