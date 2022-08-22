const { EmbedBuilder } = require('discord.js')

function translate (language, msg)
{

    const reservedWords = {
        'germany':'германия',
        'usa' :'сша',
        'japan' :'япония',
        'soviet' :'советы',
        'britain' :'британия',
        'france' :'франция',
        'italy' :'италия',
        'poland' :'польша',
        'infantry' :'пехота',
        'artillery' :'арта',
        'fighter' :'истребитель',
        'bomber' :'бомбардировщик',
        'tank' :'танк',
        'order' :'приказ',
        'countermeasure' :'контрмера',
        'blitz' :'блиц',
        'ambush' :'засада',
        'smokescreen' :'дым',
        'fury'  :'ярость',
        'guard' :'охрана',
        'alpine' :'альпийский',
        'pincer' :'клещи',
        'heavyArmor1' :'тяжелый',
        'heavyArmor2' :'тяжелый',
        'standard' :'стандартная',
        'limited' : 'ограниченная',
        'special' :'специальная',
        'elite' :'элитная'
    }

    switch (language) {
        case 'ru':
            if (msg === 'online') return 'нагибаторов онлайн'
            if (msg === 'search') return 'найдено карт'
            if (msg === 'stats') return 'последние 24 часа'
            if (msg === 'error') return 'shit..ошибочка вышла!'
            if (msg === 'limit') return ', но покажу всего '
            if (msg === 'noresult') return 'Язык поиска: ' + language.toUpperCase() + ', карт не найдено...'
            if (msg === 'langChange') return 'Язык поиска: '
            if (msg === 'help') {
                return 'Приветствую!\n\n'+
                    '**!!** - *Количество игроков онлайн и статистика*\n\n' +
                    '**!leo** - *Найдет Леопольда*\n' +
                    '**!сша пехота 3к блиц** - *Найдет карты с соответствующими параметрами*\n' +
                    '**!en** [ de| es | ft | it | ko | pl | pt | ru | tw | zh ] - *Сменить язык поиска*'
            }

            break

        case 'de':
            if (msg === 'online') return 'Steam Spieler online'
            if (msg === 'search') return 'Suchergebnisse'
            if (msg === 'stats') return 'letzte 24 Stunden'
            if (msg === 'error') return 'Scheiße, ein Fehler!'
            if (msg === 'limit') return ', ich zeige aber nur '
            if (msg === 'noresult') return 'Suchsprache: '+ language.toUpperCase() + ', nichts gefunden...'
            if (msg === 'langChange') return 'Suchsprache: '
            if (msg === 'help') {
                return 'Willkommen!\n\n'+
                    '**!!** - *Steam Spieler online and Statistiken*\n\n' +
                    '**!leo** - *findet den Leopold*\n' +
                    '**!usa infantry blitz 3k** - *findet alle Karten mit den Attributen*\n' +
                    'Nationen: **Soviet Germany Britain USA Japan Poland France Italy**\n' +
                    '**!de** [ de| es | ft | it | ko | pl | pt | ru | tw | zh ] - Suchsprache ändern'
            }

            break

        default:
            if (msg === 'online') return 'Players online'
            if (msg === 'search') return 'Cards found'
            if (msg === 'stats') return 'Last 24 hours'
            if (msg === 'error') return 'Oops... Something went wrong...'
            if (msg === 'limit') return ', but showing only the first '
            if (msg === 'noresult') return 'Search language: '+ language.toUpperCase() + '. No cards found...'
            if (msg === 'langChange') return 'Search language: '
            if (msg === 'help') {
                return 'Welcome!\n\n'+
                    '**!!** - *Steam players online and stats*\n\n' +
                    '**!leo** - *will find the Leopold*\n' +
                    '**!usa infantry blitz 3k** - *find cards with all the attributes*\n' +
                    'Nations for search: **Soviet Germany Britain USA Japan Poland France Italy**\n' +
                    'Advanced search requires at least 2 parameters. Every word should contain at least 3 chars.\n' +
                    '**!en** [ de | es | ft | it | ko | pl | pt | ru | tw | zh ] - change the search language'
            }
            //translate meta keywords from rus to eng
            for (const [key, value] of Object.entries(reservedWords)) {
                if (msg.slice(0,3) === value.slice(0,3)) {

                    return key
                }
            }

            return msg
    }
}

/**
 *
 * @param language
 * @returns {{image: {url: string}, thumbnail: {url: string}, color: number, footer: {icon_url: string, text: string}, author: {icon_url: string, name: string, url: string}, description: string, title: string, fields: [{inline: boolean, name: string, value: string},{inline: boolean, name: string, value: string},{inline: boolean, name: string, value: string}], url: string, timestamp: string}}
 */
function getHelp(language)
{

    const image = 'https://userfiles.uptimerobot.com/img/1125952-1651958589.png'

    return  {
        color: 0x0099ff,
        title: 'Help',
        url: 'https://discord.com/channels/817700750083358720',
        author: {
            name: 'tortunbator',
            icon_url: 'https://cdn.discordapp.com/attachments/817700750083358722/1011218483624824842/katyusha.png',
            url: 'https://github.com/alex-weber/',
        },
        description: 'Some description here',
        thumbnail: {
            url: image,
        },
        fields: [
            {
                name: '!!',
                value: 'Steam players online and stats',
                inline: true,
            },
            {
                name: '!usa infantry 3k 1c smokescreen 5/5',
                value: 'Finds the US infantry with attack 5, defense 5, for 3 kredits, ' +
                  '1 operation cost and smokescreen',
                inline: true,
            },
            {
                name: '!td',
                value: 'The Top Deck Game. Works only in channels that contain the string "bot" ',
                inline: true,
            },

        ],
        image: {
            url: image,
        },
        timestamp: new Date().toISOString(),
        footer: {
            text: 'Katyusha Kards Bot',
            icon_url: image,
        }
    }

}

module.exports = { translate, getHelp }