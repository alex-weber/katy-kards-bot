const getLanguageByInput = function (str)
{
    let language = defaultLanguage
    //russian
    const cyrillicPattern = /[а-я]/
    if (cyrillicPattern.test(str)) language = 'ru'

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