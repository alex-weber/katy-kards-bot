/**
 *
 * @param language
 * @param msg
 * @returns {string|*}
 */
function translate(language, msg)
{
    const reservedWords = {
        'germany': 'германия',
        'german': 'немецкий',
        'usa': 'сша',
        'japan': 'япония',
        'soviet': 'советы',
        'britain': 'британия',
        'france': 'франция',
        'italy': 'италия',
        'poland': 'польша',
        'finland': 'финляндия',
        'infantry': 'пехота',
        'artillery': 'арта',
        'fighter': 'истребитель',
        'bomber': 'бомбардировщик',
        'tank': 'танк',
        'order': 'приказ',
        'countermeasure': 'контрмера',
        'blitz': 'блиц',
        'ambush': 'засада',
        'smokescreen': 'дым',
        'fury': 'ярость',
        'guard': 'охрана',
        'alpine': 'альпийский',
        'pincer': 'клещи',
        'salvage': 'утилизация',
        'heavyArmor1': 'тяж1',
        'heavyArmor2': 'тяж2',
        'standard': 'стандартная',
        'limited': 'ограниченная',
        'special': 'особая',
        'elite': 'элитная',
        'exile': 'изгнание',
    }

    switch (language)
    {
        case 'ru':
            if (msg === 'online') return 'Steam нагибаторов онлайн'
            if (msg === 'search') return 'найдено карт'
            if (msg === 'stats') return 'последние 24 часа'
            if (msg === 'error') return 'ой, ошибочка вышла!'
            if (msg === 'limit') return ', но покажу всего '
            if (msg === 'noshow') return ', ничего не покажу, попробуйте быть точнее.'
            if (msg === 'time') return 'Время сейчас'
            if (msg === 'noresult') return 'Язык поиска: ' + language.toUpperCase() + ', карт не найдено...'
            if (msg === 'langChange') return 'Язык поиска: '
            if (msg === 'help')
            {
                return 'Приветствую!\n\n' +
                    '!! - Количество игроков онлайн и статистика\n' +
                    '!leo - Найдет Леопольда\n' +
                    'Первые 3 символа слова используются для поиска атрибутов.\n' +
                    'Все ненайденные слова добавляются в поиск в заголовке и тексте.\n' +
                    '3k - Стоимость развертывания\n' +
                    '2ц - Стоимость операции\n' +
                    '5-5 или 5/5 - пять атаки и пять защиты\n' +
                    '!советская пехота охрана 1/8 3k 1ц \n' +
                    'Можете использовать * в качестве заменителя для любой атаки или любой защиты.\n' +
                    'Страны для поиска: Советы Германия Британия США Япония Польша Франция Италия Финляндия.\n' +
                    '!en [ de| es | fr | it | jp | ko | pl | pt | ru | tw | zh ] - Сменить язык поиска\n'
            }
            break
        case 'de':
            if (msg === 'online') return 'Steam Spieler online'
            if (msg === 'search') return 'Suchergebnisse'
            if (msg === 'stats') return 'Die letzten 24 Stunden'
            if (msg === 'error') return 'Oops, ein Fehler!'
            if (msg === 'limit') return ', ich zeige aber nur '
            if (msg === 'noshow') return ', ich zeige gar nichts, bitte die Suche verfeinern.'
            if (msg === 'time') return 'Die aktuelle Zeit'
            if (msg === 'noresult') return 'Suchsprache: ' + language.toUpperCase() + ', nichts gefunden...'
            if (msg === 'langChange') return 'Suchsprache: '
            if (msg === 'help')
            {
                return 'Willkommen!\n\n' +
                    '**!!** - *Steam Spieler online and Statistiken*\n\n' +
                    '**!leo** - *findet den Leopold*\n' +
                    '**!usa infantry blitz 4k 4/4 4c ** - *findet alle Karten mit den Attributen*\n' +
                    'Nationen: **Soviet Germany Britain USA Japan Poland France Italy Finland**\n' +
                    '**!de** [ de| es | fr | it | jp | ko | pl | pt | ru | tw | zh ] - Suchsprache ändern\n'

            }
            break
        default: //en
            if (msg === 'online') return 'Steam players online'
            if (msg === 'search') return 'Cards found'
            if (msg === 'stats') return 'Last 24 hours'
            if (msg === 'error') return 'Oops... Something went wrong...'
            if (msg === 'limit') return ', but showing only the first '
            if (msg === 'noshow') return ', refusing to show anything, please make a more precise search request.'
            if (msg === 'time') return 'Time now'
            if (msg === 'noresult') return 'Search language: ' + language.toUpperCase() + '. No cards found...'
            if (msg === 'langChange') return 'Search language: '
            if (msg === 'help')
            {
                return 'Welcome!\n\n' +
                    '!! - Steam players online and stats\n\n' +
                    '!leo - will find the Leopold\n' +
                    'All not found words will be used for searching in title and text.\n' +
                    '3k - Deployment cost\n' +
                    '2c or 2op  - Operation cost\n' +
                    '5-5 or 5/5 - Five attack and five defense\n' +
                    '!soviet infantry guard 1/8 3k 1c\n' +
                    'You can use * as placeholder for any attack or any defense\n' +
                    'You can also trigger the search without a leading prefix - show me %leo% please\n' +
                    'Nations for search: Soviet Germany Britain USA Japan Poland France Italy Finland\n' +
                    '!td [infantry | tank | artillery | fighter | bomber] ' +
                    '- 2 random cards fight. You can pick the unit type or leave it blank.\n' +
                    '!ranking - Top Deck Ranking\n' +
                    '!myrank - Your personal Top Deck Ranking with stats.\n\n' +
                    '!en [ de | es | fr | it | jp | ko | pl | pt | ru | tw | zh ] - change the search language.\n\n'

            }
            //translate meta keywords from ru to en
            for (const [key, value] of Object.entries(reservedWords))
            {
                if (msg.slice(0, 3) === value.slice(0, 3)) return key
            }

            return msg
    }
}

module.exports = {translate}