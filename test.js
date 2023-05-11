const search = require("./search")
const {getUser, getTopDeckStats, updateUser, getCardsDB} = require("./db")
const {getLanguageByInput, defaultLanguage} = require("./language")
const {handleSynonym, isManager, advancedSearch, getCards, getFiles} = require("./search")
const { drawBattlefield } = require('./canvasManager')
const fs = require("fs")
const { getHelp } = require('./translator.js')
const translator = require("./translator")
const dictionary = require("./dictionary")
const { topDeck, myTDRank } = require("./topDeck")
const {getCardsStats, getStats} = require("./stats")
const {telegramClient, telegramMessage, Input, getMediaGroup} = require('./telegram')
const bot = require("./bot");
const {translate} = require("./translator");

async function searchBlya(input) {

    //try to find the language and store it in the DB
    let language = 'en'
    let variables = { language : language, showSpawnables: true }
    variables.q = input
    let cards = await search.advancedSearch(variables)
    console.log(cards)
    if (cards.counter) {
        let files = search.getFiles(cards, language)
        console.log(files)
    }
    else console.log('nothing...')

}

async function topDeckGame() {

    let player = await getUser('22')
    let td = await topDeck('1', player, 'td')
    if (td.state === 'open') {

        if (td.unitType) {
            console.log('**' + td.unitType.toUpperCase()+ '** battle\n')
        }
    }
    console.log('Waiting for another player...')
    let player2 = await getUser('44')
    //console.log(player)
    td = await topDeck('1', player2, 'td')
    //const battleImage = await drawBattlefield(td)
    console.log(td)

}

async function raiting()
{
    //await topDeckGame()
    //console.log(await getTopDeckStats())
    let user = await getUser('44')
    user.role = ''
    await updateUser(user)
    console.log(isManager(user))
}

async function quotes(command)
{
    let user = await getUser('44')
    command = bot.parseCommand("!", command)
    let language = getLanguageByInput(command)
    if (language === 'ru') user.language = language
    else if (user.language !== language) language = user.language
    console.log(language)
    await updateUser(user)


}

async function telMedia()
{
    //testing search
    let language = 'en'
    let variables = {
        'language': language,
        'q': '!leo'.slice(1),
        'showSpawnables': true,
    }
    let searchResult = await getCards(variables)
    if (!searchResult) return
    if (!searchResult.counter) console.log('no cards found')
    let files = getFiles(searchResult, language)
    console.log(files)
    if (searchResult.counter > 1)
    {

        console.log(getMediaGroup(files))
    }
    else if (searchResult.counter === 1) {
        console.log(files[0].attachment)
        ///await ctx.replyWithPhoto(Input.fromURL(url))
    }
}

async function createJSON()
{
    let cards = await getCardsDB({})
    //console.log(cards)
    //save the file
    fs.writeFile(
        'export/cards.json',
        JSON.stringify(cards),
        function (err) {
            if (err) console.log('could not write file')
            else console.log('JSON created!')
        })
}

async function prismaTest()
{

    let variables = {
        OR: [

            {
                AND: [
                    {
                        title: {
                            contains: 'shuffl',
                            mode: 'insensitive',
                        }
                    },
                    {
                        title: {
                            contains: 'rand',
                            mode: 'insensitive',
                        }
                    },
                ]
            },

            {
                AND: [
                    {
                        text: {
                            contains: 'shuffle',
                            mode: 'insensitive',
                        }
                    },
                    {
                        text: {
                            contains: 'random',
                            mode: 'insensitive',
                        }
                    },
                ]
            },
        ]
    }

    let cards = await getCardsDB(variables)
    console.log(cards)

}
searchBlya('brit arty pin again').catch((e) => {console.log(e) })


