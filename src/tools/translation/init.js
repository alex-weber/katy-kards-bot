const translator = require('i18next')
const backend = require('i18next-fs-backend')
const path = require('path')

function init() {
    translator
        .use(backend)
        .init({
            lng: 'en',
            fallbackLng: ['en', 'ru', 'de'],
            //debug: true,
            backend: {
                loadPath: path.resolve(__dirname, 'locales/{{lng}}/{{ns}}.json'),
                addPath: path.resolve(__dirname, 'locales/{{lng}}/{{ns}}.missing.json'),
            }
        })

    return translator
}

module.exports = {init}




