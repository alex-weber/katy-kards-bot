module.exports = {

    faction: [
        'soviet',
        'usa',
        'japan',
        'germany',
        'britain',
        'france',
        'italy',
        'poland',
        'finland',
        'neutral',
        'anzac',
    ],
    type: [
        'infantry',
        'artillery',
        'fighter',
        'bomber',
        'tank',
        'order',
        'countermeasure'
    ],
    rarity: [
        'standard',
        'limited',
        'special',
        'elite'
    ],
    attribute: [
        'alpine',
        'blitz',
        'ambush',
        'intel',
        'smokescreen',
        'guard',
        'mobilize',
        'pincer',
        'heavy armor',
        'fury',
        'veteran',
        'salvage',
        'covert',
        'shock',
        'bond',
        'forecast',
    ],
    // Attributes the API stores with a level or a card reference appended:
    // "heavyarmor2", "intel3", "veteranof:panzer_ivh_vet". Everything sharing a
    // prefix is counted as the one keyword it maps to. "becomesveteran:*" is a
    // different keyword and deliberately has no entry here.
    attributePrefix: {
        'heavyarmor': 'heavy armor',
        'intel': 'intel',
        'veteranof': 'veteran',
    },
    synonyms: {

        milkshake: '34th infantry regiment',
        sexy: '47th infantry regiment',
        ass: '47th infantry regiment',
        choco: '32nd infantry regiment',
        chocco: '32nd infantry regiment',
        chocoboy: '32nd infantry regiment',
        chocoboys: '32nd infantry regiment',
        chocolate: '32nd infantry regiment',
        milktruck: '332nd engineer regiment',
        beefwagon: 'befehlswagen',
        senpai: 'sendai regiment',
        slow: 'fast heinz',
        baby: 'autokanone',
        elephant: '114',
        cas: 'close air support',
        uws: 'united we stand',
        wcd: 'we can do it',

    },
    botwar: {
        channels: [
            '1010050763382345748',
            '976218336968990740',
            '972973776264376340',
            '912718284095377418',
            '986518718110650369',
        ]
    },
    englishOnly: {
        channels: [
            '708364195493838898',
            '1231751456923717635',
        ]
    }

}