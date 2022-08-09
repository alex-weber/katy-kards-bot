const getLanguageByInput = function (str)
{
    let language = 'en'
    const firstLetter = str.slice(0,1)
    const lastLetter = str.slice(-1)
    //russian
    const cyrillicPattern = /^[\u0400-\u04FF]+$/
    if ( cyrillicPattern.test(firstLetter) || cyrillicPattern.test(lastLetter) ) language = 'ru'

    return language
}
//all supported languages on kards.com
const languages = ['de', 'en', 'es', 'fr', 'it', 'ko', 'pl', 'pt', 'ru', 'tw', 'zh']
const searchLanguages = ['de', 'en', 'es', 'fr', 'it', 'ko', 'pl', 'pt', 'ru', 'zh-Hant', 'zh-Hans']

module.exports = { getLanguageByInput, languages, searchLanguages }