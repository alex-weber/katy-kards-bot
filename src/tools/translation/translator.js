const {init} = require('./init')
const translator = init()

/**
 *
 * @param language
 * @param msg
 * @returns {string|*}
 */
function translate(language, msg)
{
    //translate meta keywords from ru to en
    const reservedWords = getReservedWords()
    for (const [key, value] of Object.entries(reservedWords))
    {
        if (msg.length > 2 && value.indexOf(msg) === 0) return key //found the reserved word
    }
    //translation found
    if (translator.exists(msg, {lng: language}))
    {
        let message = translator.t(msg, {lng: language})
        return message.replace('{{language}}', language.toUpperCase())
    }
    //no translation
    return msg
}

/**
 *
 * @returns {object}
 */
function getReservedWords()
{
    return {
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
        'artillery': 'артиллерия',
        'fighter': 'истребитель',
        'bomber': 'бомбардировщик',
        'tank': 'танк',
        'order': 'приказ',
        'countermeasure': 'контрмера',
        'blitz': 'блиц',
        'ambush': 'засада',
        'smokescreen': 'дымовая',
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
        'covert': 'скрытный',
        'shock': 'штурм',
        'veteran': 'ветеран'
    }

}

module.exports = {translate, getReservedWords}