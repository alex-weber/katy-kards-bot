const axios = require("axios")
const query = require("./query")
const dictionary = require('./dictionary')
const translator = require('./translator.js')
const { MessageAttachment } = require('discord.js')
const { getCardsDB, getSynonym, createSynonym } = require('./db')
const {APILanguages} = require("./language");
const host = 'https://www.kards.com'
const limit = parseInt(process.env.LIMIT) || 5 //attachment limit for discord
/**
 *
 * @param variables
 * @returns {*}
 */
function getVariables(variables) {

    const words = variables.q.split(' ')
    //allow to search with at least 2 attributes
    if (words.length < 2) return false
    //unset the search string
    variables.q = ''
    for (let i = 0; i < words.length; i++) {
        variables = setAttribute(translator.translate('en', words[i]), variables)
    }

    /**
     *
     * @param word
     * @param variables
     * @returns {*}
     */
    function setAttribute(word, variables) {

        if (typeof word !== 'string') return variables

        let faction = getAttribute(word, dictionary.faction)
        if (faction) {
            variables.faction = faction

            return  variables
        }
        let type = getAttribute(word, dictionary.type)
        if (type) {
            variables.type = type

            return  variables
        }
        let rarity = getAttribute(word, dictionary.rarity)
        if (rarity) {
            variables.rarity = rarity

            return  variables
        }
        let attribute = getAttribute(word, dictionary.attribute)
        if (attribute) {
            variables.attributes = attribute

            return  variables
        }
        if (word.endsWith('k') || word.endsWith('к') ) {
            let kredits = parseInt(word.substring(0, word.length - 1))
            if (!isNaN(kredits)) {
                variables.kredits = kredits

                return  variables
            }
        }
        if (word.endsWith('c') || word.endsWith('ц') ) {
            let costs = parseInt(word.substring(0, word.length - 1))
            if (!isNaN(costs)) {
                variables.operationCost = costs

                return  variables
            }
        }
        let stats = word.match('\\d+(\\/|-)\\d+')
        if (stats) {
            let matches = stats[0]
            let delimiter = stats[1]
            let both = matches.split(delimiter)
            variables.attack = parseInt(both[0])
            variables.defense = parseInt(both[1])
        }

        return variables
    }
    //return it anyway
    return variables
}

/**
 *
 * @param word
 * @param attributes
 * @returns {String}
 */
function getAttribute(word, attributes) {
    let result = ''
    //do not search if the word is shorter than 3 chars
    if (word.length < 3) return result

    for (const [key, value] of Object.entries(attributes)) {
       if ( key.slice(0,3) === word.slice(0,3) ||
            (typeof value === 'string' &&  value.slice(0,3) === word.slice(0,3)) )
       {
           result = value
           break
       }
    }

    return result
}

/**
 *
 * @param variables
 * @returns {Promise<boolean|*>}
 */
async function getCards(variables) {
    //log request
    console.log(variables)
    //search on kards.com
    let response = await axios.post(
        'https://api.kards.com/graphql',
        {
        "operationName": "getCards",
        "variables": variables,
        "query": query
        }
    ).catch(error => {
        console.log('request to kards.com failed ', error.errno, error.data)
    })

    if (response) {
        const counter = response.data.data.cards.pageInfo.count
        const cards = response.data.data.cards.edges
        if (!counter) {

            return await advancedSearch(variables)
        }

        return { counter: counter, cards: cards }
    }

    return await advancedSearch(variables)
}

/**
 *
 * @param cards
 * @param language
 * @returns {*[]}
 */
function getFiles(cards, language) {

    let files = []
    if (language !== 'zh-Hant') language = APILanguages[language]
    for (const [, value] of Object.entries(cards.cards)) {
        //check if the response is from kards.com or internal
        let imageURL = ''
        if (value.hasOwnProperty('imageURL')) imageURL = value.imageURL
        else if (value.hasOwnProperty('node')) imageURL = value.node.imageUrl
        //replace language in the image link
        imageURL = imageURL.replace('en-EN', language)
        let attachment = new MessageAttachment(host + imageURL)
        files.push(attachment)
        if (files.length === limit) break
    }

    return files
}

/**
 *
 * @param variables
 * @returns {Promise<*>}
 */
async function advancedSearch(variables)
{
    variables = getVariables(variables)
    //delete non DB fields
    delete variables.q
    delete variables.language
    delete variables.showSpawnables
    if (variables.hasOwnProperty('attributes')) {
        variables.attributes = {
            contains: variables.attributes,
        }
    }
    if (Object.keys(variables).length === 0) {
        console.log('no variables set')

        return {counter: 0, cards: []}
    }
    console.log(variables)
    let cards = await getCardsDB(variables)

    return { counter: cards.length, cards: cards }
}

async function handleSynonym(user, command)
{
    if (user.role !== 'GOD' && user.role !== 'VIP') return null
    const data = command.split('=')
    if (data.length < 2) return null
    console.log(data)
    const key = data[0].slice(1)
    let value = data.slice(1).toString()
    value = value.replace(/,/gi, ' ')

    console.log(key, value)

    //allow only a-z chars
    let allowedChars = /^[\sa-z0-9]+$/
    if (!allowedChars.test(key)) {

        return null
    }
    //allow also numbers slashes and dots
    allowedChars = /^[\sa-zA-Z:0-9\/\._-]+$/
    if (!allowedChars.test(value)) {

        return null
    }
    let syn = await getSynonym(key)
    if (!syn && value) {
        syn = await createSynonym(key, value)
    }

    return syn
}

//export
module.exports = { getCards, getFiles, handleSynonym }