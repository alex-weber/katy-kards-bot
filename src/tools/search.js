const axios = require("axios")
const query = require("./query")
const dictionary = require('./dictionary')
const {translate} = require('./translation/translator.js')
const {MessageAttachment} = require('discord.js')
const {
    getCardsDB,
    getSynonym,
    createSynonym,
    updateSynonym,
    deleteSynonym,
    getAllSynonyms
} = require('../database/db')
const {APILanguages} = require("./language")
const host = 'https://www.kards.com'
const maxMessageLength = 4000
const {uploadImage} = require("../tools/imageUpload")

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
    //move attributes to text if it is a non-unit card
    if ((['order', 'countermeasure']).includes(variables.type) && variables.attributes)
    {
        if (!variables.text) variables.text = []
        variables.text.push(variables.attributes)
        delete variables.attributes
    }
    //return it anyway
    return variables
}

/**
 *
 * @param word
 * @returns {word}
 */
function getKnownWord(word)
{
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
        case 'russia':
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
        case 'pl':
            word = 'poland'
            break
        case 'japanese':
        case 'jp':
        case 'jpn':
            word = 'japan'
            break
        case 'italian':
            word = 'italy'
            break
        case 'finnish':
            word = 'finland'
            break
        case 'arty':
            word = 'artillery'
            break
    }

    return word
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
    word = getKnownWord(word)
    switch (word) {
        case 'plane':
        case 'planes':
        case 'air':
            variables.type = {in: ['bomber', 'fighter']}
            return variables
        case 'unit':
        case 'units':
            variables.type = {notIn: ['order', 'countermeasure']}
            return variables
        case 'pin':
            variables.text = ['pin']
            return variables
    }
    let attributes = ['faction', 'type', 'rarity']
    for (const attr of attributes) {
        let dictionaryAttr = getAttribute(word, dictionary[attr])
        if (dictionaryAttr)
        {
            variables[attr] = dictionaryAttr
            return variables
        }
    }

    //do not set attributes if it is a non-unit card
    if (variables.type !== 'order' && variables.type !== 'countermeasure')
    {
        let attribute = getAttribute(word, dictionary.attribute)
        if (attribute)
        {
            variables.attributes = attribute
            return variables
        }
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
    const label = 'getCards_' + Date.now()
    console.time(label)
    //search on kards.com
    let response = await axios.post(
        'https://api.kards.com/graphql',
        {
            "operationName": "getCards",
            "variables": variables,
            "query": query
        },
        {timeout: 3000} //wait 3 seconds for the response
    ).catch(error =>
    {
        console.log('request to kards.com failed ', error.errno, error.data)

    })
    console.timeEnd(label)
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
    language = APILanguages[language]
    for (const [, card] of Object.entries(cards.cards))
    {
        //check if the response is from kards.com or internal
        let imageURL = ''
        let reserved = false
        if (card.hasOwnProperty('imageURL'))
        {
            imageURL = card.imageURL
            reserved = card.reserved
        } else if (card.hasOwnProperty('node'))
        {
            imageURL = card.node.imageUrl
            reserved = card.node.reserved
        }
        //replace language in the image link
        imageURL = imageURL.replace('en-EN', language)
        let imageName = null
        if (reserved) imageName = 'reserved'
        let attachment = new MessageAttachment(host + imageURL)
        attachment = attachment.setDescription(imageName)
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
    delete variables.showReserved
    //search for attributes also in text
    if (variables.hasOwnProperty('attributes'))
    {
        if (!variables.OR) variables.OR = []
        variables.OR.push({
            attributes: {
                contains: variables.attributes,
            }
        })
        if (!variables.text) variables.text = []
        variables.text.push(variables.attributes)
        delete variables.attributes

    }
    //search for exile also in text
    if (variables.hasOwnProperty('exile'))
    {
        if (!variables.OR) variables.OR = []
        variables.OR.push({
            exile: {not: ''}
        })
        if (!variables.text) variables.text = []
        variables.text.push('exile')
        delete variables.exile
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
        if (!variables.OR) variables.OR = []
        variables.OR.push({
            AND: andConditionsTitle
        })
        variables.OR.push({
            AND: andConditionsText
        })

        delete variables.text
    }

    console.dir(variables, {depth: null})
    const label = 'getCardsDB_' + Date.now()
    console.time(label)
    let cards = await getCardsDB(variables)
    console.timeEnd(label)

    return {counter: cards.length, cards: cards}
}

/**
 *
 * @param user
 * @param message
 * @returns {Promise<false|*>}
 */
async function handleSynonym(user, message)
{
    if (!isManager(user)) return 'not allowed'
    const content = message.content
    //remove the prefix and the ^ from the beginning and get the key and the value
    const key = content.slice(2, content.indexOf('='))
    let value
    //get the image as attachment
    if (message.attachments.size)
    {
        const attachment = message.attachments.first()
        value = attachment.url
        //upload it to a different hosting because Discord's images will expire in 2 weeks
        const uploaded = await uploadImage(value)
        if (uploaded) value = uploaded
        else return 'file upload error'
    }
    else value = content.slice(content.indexOf('=') + 1)
    console.log(key, value)
    //check key
    if (!checkSynonymKey(key)) return false
    if (value.startsWith('http'))
    {
        value = getURL(value)
        if (!value) return 'bad URL'
    }
    let syn = await getSynonym(key)
    if (!syn && value)
    {
        await createSynonym(key, value)
        return 'created'
    } else if (value === 'delete')
    {
        await deleteSynonym(key)
        return 'deleted'
    } else
    {
        await updateSynonym(key, value)
        return 'updated'
    }
}

/**
 *
 * @param value
 * @returns {boolean|string}
 */
function getURL(value)
{
    try
    {
        const url = new URL(value)
        return url.toString()
    } catch (e)
    {
        console.log(e.message)
        return false
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
 * @param command
 * @returns {Promise<string|null>}
 */
async function listSynonyms(command)
{
    const data = command.split('=')
    let listing = '```\n' //start code block to avoid Discord to parse hyperlinks
    if (data.length === 2 && checkSynonymKey(data[1]))
    {
        let synObject = await getSynonym(data[1])
        if (synObject)
        {
            return listing + synObject.key + ': ' + synObject.value + '```'
        } else return 'not found'
    }

    const synonyms = await getAllSynonyms()

    for (const [, syn] of Object.entries(synonyms))
    {
        listing += syn.key + '\n'
    }

    if (listing.length > maxMessageLength)
    {
        listing = listing.slice(0, maxMessageLength - 4)
    }
    listing += '```\n' //end code block

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
    if (message.guildId) return (
        dictionary.botwar.channels.includes(message.channelId.toString()) ||
        message.channel.name.search('bot') !== -1)
    else return true
}

module.exports = {
    getCards,
    getFiles,
    listSynonyms,
    handleSynonym,
    isBotCommandChannel,
    isManager,
}