const axios = require("axios")
const query = require("./query")
const dictionary = require('./dictionary')
const translator = require('./translator.js')
const { MessageAttachment } = require('discord.js')
const host = 'https://www.kards.com'
/**
 *
 * @param variables
 * @returns {*}
 */
function getVariables (variables) {

    const words = variables.q.split(' ')
    //allow to search with at least 2 attributes
    if (words.length < 2) return variables
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

        let nationID = getAttribute(word, dictionary.nation)
        if (nationID) {
            variables.nationIds = [nationID]

            return  variables
        }
        let type = getAttribute(word, dictionary.type)
        if (type) {
            variables.type = [type]

            return  variables
        }
        let rarity = getAttribute(word, dictionary.rarity)
        if (rarity) {
            variables.rarity = [rarity.charAt(0).toUpperCase() + rarity.slice(1)]

            return  variables
        }
        if (word.endsWith('k') || word.endsWith('к') ) {
            let kredits = parseInt(word.substring(0, word.length - 1))
            if (!isNaN(kredits)) {
                variables.kredits = [kredits]

                return  variables
            }
        }
        //so when no nation | type | rarity found, add the word as the search string
        variables.q = word

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
 * @param advanced
 * @returns {Promise<AxiosResponse<any>>}
 */
async function getCards(variables, advanced = false) {
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
        console.log(error.errno, error.data)
    })
    if (response) {
        let counter = response.data.data.cards.pageInfo.count
        if (!counter && !advanced) {
            variables = getVariables(variables)
            response = await getCards(variables, true)
        }

        return response
    }

    return response
}

/**
 *
 * @param cards
 * @param limit
 * @returns {*[]}
 */
function getFiles(cards, limit) {

    let files = []
    for (const [, value] of Object.entries(cards)) {
        let attachment = new MessageAttachment(host + value.node.imageUrl)
        files.push(attachment)
        if (files.length === limit) break
    }

    return files
}
//export
module.exports = { getCards, getFiles }