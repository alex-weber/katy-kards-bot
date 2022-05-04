module.exports.translate = function (language, msg) {

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
            if (msg === 'noresult') return 'карт не найдено...'


            break


        case 'en':
            if (msg === 'online') return 'Players online'
            if (msg === 'search') return 'Cards found'
            if (msg === 'stats') return 'Last 24 hours'
            if (msg === 'error') return 'Oops... Something went wrong...'
            if (msg === 'limit') return ', but showing only the first'
            if (msg === 'noresult') return 'No cards found...'

            for (const [key, value] of Object.entries(reservedWords)) {
                if (msg.slice(0,3) === value.slice(0,3)) {

                    return key
                }
            }

            return msg

    }

};