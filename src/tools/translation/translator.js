const {init} = require('./init')
let translator = init()

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

    if (language === 'en')
    {
        //translate meta keywords from ru to en
        for (const [key, value] of Object.entries(reservedWords))
        {
            if (value.indexOf(msg) === 0) return key
        }
    }
    if (translator.exists(msg, {lng: language}))
    {
        let message = translator.t(msg, {lng: language})
        return message.replace('{{language}}', language.toUpperCase())
    }

    return msg
}

module.exports = {translate}