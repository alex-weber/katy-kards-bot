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
        'usa': 'сша',
        'japan': 'япония',
        'soviet': 'советы',
        'britain': 'британия',
        'france': 'франция',
        'italy': 'италия',
        'poland': 'польша',
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
        'heavyArmor1': 'тяжелый',
        'heavyArmor2': 'тяжелый',
        'standard': 'стандартная',
        'limited': 'ограниченная',
        'special': 'специальная',
        'elite': 'элитная',
        'exile': 'изгнание',
    }

    switch (language)
    {
        case 'ru':
            if (msg === 'online') return 'Steam нагибаторов онлайн'
            if (msg === 'search') return 'найдено карт'
            if (msg === 'stats') return 'последние 24 часа'
            if (msg === 'error') return 'shit..ошибочка вышла!'
            if (msg === 'limit') return ', но покажу всего '
            if (msg === 'time') return 'Время сейчас'
            if (msg === 'noresult') return 'Язык поиска: ' + language.toUpperCase() + ', карт не найдено...'
            if (msg === 'langChange') return 'Язык поиска: '
            if (msg === 'help')
            {
                return 'Приветствую!\n\n' +
                    '!! - Количество игроков онлайн и статистика\n' +
                    '!leo - Найдет Леопольда\n' +
                    'Первые 3 символа слова используются для поиска атрибутов.\n' +
                    'Все ненайденные слова добавляются в поиск по полной строке в заголовке и тексте.\n' +
                    '3k - Стоимость развертывания\n' +
                    '2ц - Стоимость операции\n' +
                    '5-5 или 5/5 - пять атаки и пять защиты\n' +
                    '!советская пехота 1/8 3k 1c \n' +
                    'Можете использовать знак умножения в качестве заменителя для любой атаки или любой защиты.\n' +
                    'Страны для поиска: Советы Германия Великобритания США Япония Польша Франция Италия.\n' +
                    '!en [ de| es | ft | it | ko | pl | pt | ru | tw | zh ] - Сменить язык поиска'
            }
            break
        case 'de':
            if (msg === 'online') return 'Steam Spieler online'
            if (msg === 'search') return 'Suchergebnisse'
            if (msg === 'stats') return 'Die letzten 24 Stunden'
            if (msg === 'error') return 'Scheiße, ein Fehler!'
            if (msg === 'limit') return ', ich zeige aber nur '
            if (msg === 'time') return 'Die aktuelle Zeit'
            if (msg === 'noresult') return 'Suchsprache: ' + language.toUpperCase() + ', nichts gefunden...'
            if (msg === 'langChange') return 'Suchsprache: '
            if (msg === 'help')
            {
                return 'Willkommen!\n\n' +
                    '**!!** - *Steam Spieler online and Statistiken*\n\n' +
                    '**!leo** - *findet den Leopold*\n' +
                    '**!usa infantry blitz 3k** - *findet alle Karten mit den Attributen*\n' +
                    'Nationen: **Soviet Germany Britain USA Japan Poland France Italy**\n' +
                    '**!de** [ de| es | ft | it | ko | pl | pt | ru | tw | zh ] - Suchsprache ändern'
            }
            break
        default: //en
            if (msg === 'online') return 'Steam players online'
            if (msg === 'search') return 'Cards found'
            if (msg === 'stats') return 'Last 24 hours'
            if (msg === 'error') return 'Oops... Something went wrong...'
            if (msg === 'limit') return ', but showing only the first '
            if (msg === 'time') return 'Time now'
            if (msg === 'noresult') return 'Search language: ' + language.toUpperCase() + '. No cards found...'
            if (msg === 'langChange') return 'Search language: '
            if (msg === 'help')
            {
                return 'Welcome!\n\n' +
                    '**!!** - *Steam players online and stats*\n\n' +
                    '**!leo** - *will find the Leopold*\n' +
                    'The first 3 charachters of a word are used to search for attributes. \n' +
                    'All not found words are added to a full string search in title and text.\n' +
                    '3k - Deployment cost\n' +
                    '2c or 2op  - Operation cost\n' +
                    '5-5 or 5/5 - Five attack and five defense\n' +
                    '!soviet infantry guard 1/8 3k 1c\n' +
                    'You can use ** * ** as placeholder for any attack or any defense\n' +
                    'Nations for search: **Soviet Germany Britain USA Japan Poland France Italy**\n' +
                    '**!td [infantry | tank | artillery | fighter | bomber]**\n' +
                    '- 2 random cards fight. You can pick the unit type or leave it blank.\n' +
                    '**!ranking** - Top Deck Ranking\n' +
                    '**!myrank** - Your personal Top Deck Ranking with stats.\n\n' +
                    '**!en** [ de | es | ft | it | ko | pl | pt | ru | tw | zh ] - change the search language.\n\n' +
                    'The hosting costs 12$ a month. (Heroku Hobby 7$ + pgSQL mini 5$)\n' +
                    'If you want to support me: https://www.paypal.me/kropotor'

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