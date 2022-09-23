const getLanguageByInput = function (str)
{
    let language = defaultLanguage
    const firstLetter = str.slice(0, 1)
    const lastLetter = str.slice(-1)
    //russian
    const cyrillicPattern = /^[\u0400-\u04FF]+$/
    if (cyrillicPattern.test(firstLetter) || cyrillicPattern.test(lastLetter)) language = 'ru'

    return language
}
//all supported languages on kards.com
const languages = ['de', 'en', 'es', 'fr', 'it', 'ko', 'pl', 'pt', 'ru', 'tw', 'zh']
const searchLanguages = ['de', 'en', 'es', 'fr', 'it', 'ko', 'pl', 'pt', 'ru', 'zh-Hant', 'zh-Hans']
const APILanguages = {
    de: 'de-DE',
    en: 'en-EN',
    es: 'es-ES',
    fr: 'fr-FR',
    it: 'it-IT',
    ko: 'ko-KR',
    pl: 'pl-PL',
    pt: 'pt-BR',
    ru: 'ru-RU',
    tw: 'zh-Hant',
    zh: 'zh-Hans',
}
const defaultLanguage = 'en'

module.exports = {getLanguageByInput, languages, searchLanguages, APILanguages, defaultLanguage}