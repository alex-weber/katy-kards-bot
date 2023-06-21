const axios = require("axios")
const query = require("./query")
const dictionary = require('./dictionary')
const {translate} = require('./translator.js')
const {MessageAttachment} = require('discord.js')
const {getCardsDB, getSynonym, createSynonym, updateSynonym, deleteSynonym, getAllSynonyms} = require('./db')
const {APILanguages} = require("./language")
const host = 'https://www.kards.com'
const maxMessageLength = 4000
/**
 *
 * @param variables
 * @returns {*}
 */
function getVariables(variables)
{
    const words = variables.q.split(' ')
    if (!words.length) return false
    //unset the search string
    variables.q = ''
    for (const word of words)
    {
        variables = setAttribute(translate('en', word), variables)
    }

    /**
     *
     * @param word
     * @param variables
     * @returns {*}
     */
    function setAttribute(word, variables)
    {
        if (typeof word !== 'string') return variables
        switch (word)
        {
            case 'us':
            case 'america':
            case 'american':
                word = 'usa'
                break
            case 'french':
                word = 'france'
                break
            case 'russian':
            case 'rus':
            case 'ussr':
                word = 'soviet'
                break
            case 'uk':
            case 'gb':
            case 'british':
                word = 'britain'
                break
            case 'polish':
                word = 'poland'
                break
            case 'japanese':
                word = 'japan'
                break
            case 'italian':
                word = 'italy'
                break
            case 'arty':
                word = 'artillery'
                break
            case 'plane':
            case 'planes':
                variables.type = { in: ['bomber', 'fighter'] }

                return variables
            case 'unit':
            case 'units':
                variables.type = { notIn: ['order', 'countermeasure'] }

                return variables
            case 'pin':
                variables.text = ['pin']

                return variables
        }
        let faction = getAttribute(word, dictionary.faction)
        if (faction)
        {
            variables.faction = faction

            return variables
        }
        let type = getAttribute(word, dictionary.type)
        if (type)
        {
            variables.type = type

            return variables
        }
        let rarity = getAttribute(word, dictionary.rarity)
        if (rarity)
        {
            variables.rarity = rarity

            return variables
        }
        let attribute = getAttribute(word, dictionary.attribute)
        if (attribute)
        {
            variables.attributes = attribute

            return variables
        }
        let exile = getAttribute(word, ['exile'])
        if (exile)
        {
            variables.exile = {not: ''}

            return variables
        }
        if (word.endsWith('k') || word.endsWith('к'))
        {
            let kredits = parseInt(word.substring(0, word.length - 1))
            if (!isNaN(kredits))
            {
                variables.kredits = kredits

                return variables
            }
        }
        if (word.endsWith('c') || word.endsWith('ц') || word.endsWith('op'))
        {
            let costs = parseInt(word.substring(0, word.length - 1))
            if (!isNaN(costs))
            {
                variables.operationCost = costs

                return variables
            }
        }
        //allow only * as placeholder for attack or defense
        let stats = word.match('^(\\d{1,2}|\\*)(\\/|-)(\\d{1,2}|\\*)$')
        if (stats)
        {
            let attack = parseInt(stats[1])
            let defense = parseInt(stats[3])
            if (!isNaN(attack)) variables.attack = attack
            if (!isNaN(defense)) variables.defense = defense

            return variables
        }
        //so if there is no parameter found - add the word to the search string
        if (variables.text === undefined) variables.text = []
        variables.text.push(word)

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
function getAttribute(word, attributes)
{
    let result = ''
    //do not search if the word is shorter than 3 chars
    if (word.length < 3) return result

    for (const [key, value] of Object.entries(attributes))
    {
        if (key.indexOf(word) === 0 || (typeof value === 'string' && value.indexOf(word) === 0))
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
async function getCards(variables)
{
    //log request
    console.log(variables)
    //search on kards.com
    let response = await axios.post(
        'https://api.kards.com/graphql',
        {
            "operationName": "getCards",
            "variables": variables,
            "query": query
        },
        { timeout: 3000} //wait 3 seconds for the response
    ).catch(error =>
    {
        console.log('request to kards.com failed ', error.errno, error.data)

    })

    if (response)
    {
        const counter = response.data.data.cards.pageInfo.count
        if (!counter)
        {

            return await advancedSearch(variables)
        }
        const cards = response.data.data.cards.edges


        return {counter: counter, cards: cards}
    }

    return await advancedSearch(variables)
}

/**
 *
 * @param cards
 * @param language
 * @param limit
 * @returns {*[]}
 */
function getFiles(cards, language, limit)
{
    let files = []
    if (language !== 'zh-Hant') language = APILanguages[language]
    for (const [, value] of Object.entries(cards.cards))
    {
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
    if (Object.keys(variables).length === 0)
    {
        console.log('no variables set')

        return {counter: 0, cards: []}
    }
    //delete non DB fields
    delete variables.q
    delete variables.language
    delete variables.showSpawnables
    if (variables.hasOwnProperty('attributes'))
    {
        variables.attributes = {
            contains: variables.attributes,
        }
    }

    if (variables.hasOwnProperty('text'))
    {
        let andConditionsTitle = []
        let andConditionsText = []
        for (const word of variables.text)
        {
            andConditionsTitle.push({
                title: {
                    contains: word,
                    mode: 'insensitive',
                }
            })
            andConditionsText.push({
                text: {
                    contains: word,
                    mode: 'insensitive',
                }
            })
        }
        variables.OR = [
            {
                AND: andConditionsTitle
            },
            {
                AND: andConditionsText
            },
        ]
        delete variables.text
    }
    console.log(variables)
    let cards = await getCardsDB(variables)

    return {counter: cards.length, cards: cards}
}

/**
 *
 * @param user
 * @param command
 * @returns {Promise<null|*>}
 */
async function handleSynonym(user, command)
{
    if (!isManager(user)) return null
    const data = command.split('=')
    if (data.length < 2) return null
    console.log(data)
    const key = data[0].slice(1)
    let value = data.slice(1).toString()
    value = value.replace(/,/gi, ' ')
    console.log(key, value)
    //check key & value
    if (!checkSynonymKey(key) || !checkSynonymValue(value)) return null
    let syn = await getSynonym(key)
    if (!syn && value)
    {
        await createSynonym(key, value)

        return 'created'
    }
    else if (value === 'delete')
    {
        await deleteSynonym(key)

        return 'deleted'
    }
    else
    {
        await updateSynonym(key, value)

        return 'updated'
    }
}

/**
 *
 * @param key
 * @returns {boolean}
 */
function checkSynonymKey(key)
{
    //allow only a-z, numbers, underscore and minus chars
    let allowedChars = /^[\sa-z0-9_-]+$/

    return allowedChars.test(key)
}

/**
 *
 * @param value
 * @returns {boolean}
 */
function checkSynonymValue(value)
{
    let allowedChars = /^[\sa-zA-Z:0-9\/\._-]+$/

    return allowedChars.test(value)
}

/**
 *
 * @param user
 * @param command
 * @returns {Promise<string|null>}
 */
async function listSynonyms(user, command)
{
    if (!isManager(user)) return null
    const data = command.split('=')
    let listing = '```' //start code block to avoid Discord to parse hyperlinks
    if (data.length === 2 && checkSynonymKey(data[1]))
    {
        let synObject = await getSynonym(data[1])
        if (synObject)
        {
            return listing + synObject.key + ': ' + synObject.value + '```'
        }
        else return 'not found'
    }

    const synonyms = await getAllSynonyms()

    for (const [, syn] of Object.entries(synonyms))
    {
        listing += syn.key + '\n'
    }
    listing += '```' //end code block
    if (listing.length > maxMessageLength) {
        listing = listing.slice(0, maxMessageLength-1)
    }

    return listing
}

/**
 *
 * @param user
 * @returns {boolean}
 */
function isManager(user)
{
    return (user.role === 'GOD' || user.role === 'VIP')
}

function isBotCommandChannel(message)
{
    return message.channel.name.search('bot') !== -1
}

module.exports = {
    getCards,
    getFiles,
    listSynonyms,
    handleSynonym,
    isManager,
    advancedSearch,
    isBotCommandChannel,
}