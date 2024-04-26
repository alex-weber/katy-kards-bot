const i18next = require('i18next')
const Backend = require('i18next-fs-backend')
const path = require('path')

async function init() {
    await i18next
        .use(Backend)
        .init({
            fallbackLng: 'en',
            debug: false,
            ns: ['translation'], // Specify the namespace(s)
            defaultNS: 'translation', // Specify the default namespace
            backend: {
                loadPath: path.resolve(__dirname, 'locales/{{lng}}/{{ns}}.json'),
                addPath: path.resolve(__dirname, 'locales/{{lng}}/{{ns}}.missing.json'),
            },
            interpolation: {
                escapeValue: false,
                formatSeparator: ',',
                format: function(value, format, lng) {
                    if (format === 'uppercase') return value.toUpperCase();
                    return value;
                }
            }
        })
}

init().then(() => {
    //const translatedGreeting = i18next.t('greeting', { name: 'John' })
    const translationKey = 'welcomeMessage'
    const translatedText = i18next.t(translationKey)
    console.log(translatedText)
})



