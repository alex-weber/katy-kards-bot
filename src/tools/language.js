const defaultLanguage = 'en'

/**
 *
 * @param str
 * @returns {string}
 */
const getLanguageByInput = function (str)
{
    let language = defaultLanguage
    //russian
    const cyrillicPattern = /[а-я]/
    if (cyrillicPattern.test(str.toLowerCase())) language = 'ru'

    return language
}
//all supported languages on kards.com
const languages = [
    'de', 'en', 'es', 'fr',
    'it', 'jp', 'ko', 'pl',
    'pt', 'ru', 'tw', 'zh',
]
const deckBuilderLanguages = [
    'de', 'es', 'fr',
    'it', 'pl', 'pt',
]
const APILanguages = {
    de: 'de-DE',
    en: 'en-EN',
    es: 'es-ES',
    fr: 'fr-FR',
    it: 'it-IT',
    jp: 'ja-JP',
    ko: 'ko-KR',
    pl: 'pl-PL',
    pt: 'pt-BR',
    ru: 'ru-RU',
    tw: 'zh-Hant',
    zh: 'zh-Hans',
    'zh-Hant': 'zh-Hant', //support old format
}

module.exports = {
    getLanguageByInput,
    languages,
    APILanguages,
    defaultLanguage,
    deckBuilderLanguages,
}