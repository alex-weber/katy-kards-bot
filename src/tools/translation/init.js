const translator = require('i18next')
const backend = require('i18next-fs-backend')
const path = require('path')
const {languages} = require('../language')

function init() {
    translator
        .use(backend)
        .init({
            lng: 'en',
            fallbackLng: ['en', 'ru', 'de'],
            // Preload every supported language so translate() (which reads
            // resources synchronously) sees them. Without this, only the init
            // and fallback languages (en/ru/de) load in time and everything
            // else silently falls back to English.
            preload: languages,
            initImmediate: false,
            //debug: true,
            backend: {
                loadPath: path.resolve(__dirname, 'locales/{{lng}}/{{ns}}.json'),
                addPath: path.resolve(__dirname, 'locales/{{lng}}/{{ns}}.missing.json'),
            }
        }).then()

    return translator
}

module.exports = {init}



