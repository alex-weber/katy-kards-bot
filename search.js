const axios = require("axios")
const query = require("./query")
const dictionary = require('./dictionary')
const translator = require('./translator.js')
const { MessageAttachment, MessageEmbed } = require('discord.js');
//const getLanguage = require('./language.js')

function getVariables (variables) {

    const words = variables.q.split(' ')
    if (words.length < 2) return variables
    //unset variables q
    variables.q = ''
    for (let i = 0; i < words.length; i++) {
        variables = setAttribute(translator.translate('en', words[i]), variables)
    }

    function setAttribute(word, variables) {

        if (typeof word !== 'string') return variables;

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
            variables.rarity = [rarity]

            return  variables
        }
        //let searchString = getAttribute(word)
        if (word.endsWith('k') || word.endsWith('к') ) {
            let kredits = parseInt(word.substring(0, word.length - 1))
            //console.log(kredits)
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

function getAttribute(word, attributes) {
    let result = false;

    for (const [key, value] of Object.entries(attributes)) {
        //console.log(typeof value === 'string')
       if ( key.slice(0,3) === word.slice(0,3) ||
            (typeof value === 'string' &&  value.slice(0,3) === word.slice(0,3)) )
       {
           result = value
           //console.log(key, value)
           break
       }
    }

    return result
}

/**
 *
 * @param variables
 * @returns {Promise<*>}
 */
async function getCards(variables, advanced = false) {
    //search on kards.com
    let response = await axios.post('https://api.kards.com/graphql', {
        "operationName": "getCards",
        "variables": variables,
        "query": query
    })
    let counter = response.data.data.cards.pageInfo.count
    if (!counter && !advanced) {
        variables = getVariables(variables)
        response = await getCards(variables, true)
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
    //let embeds = []
    let host = 'https://www.kards.com'
    for (const [key, value] of Object.entries(cards)) {

        let attachment = new MessageAttachment(host + value.node.imageUrl)
        //let embed = new MessageEmbed().setImage(host + value.node.imageUrl)
        files.push(attachment)
        //embeds.push(embed)
        if (files.length === limit) break
    }

    return files

}


module.exports = { getCards, getFiles }