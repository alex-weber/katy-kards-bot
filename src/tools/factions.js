// Display data for the card factions, shared by the cards overview page and the
// per-faction stats page (/cards/:faction).
const {faction: FACTIONS} = require('./dictionary')

const FACTION_LABELS = {
    germany: 'GERMANY',
    usa: 'USA',
    britain: 'BRITAIN',
    soviet: 'SOVIET UNION',
    japan: 'JAPAN',
    france: 'FRANCE',
    italy: 'ITALY',
    poland: 'POLAND',
    finland: 'FINLAND',
    anzac: 'ANZAC',
    neutral: 'NEUTRAL',
}

const FACTION_COLORS = {
    soviet: '#604F3D',
    usa: '#63694C',
    japan: '#9D7C41',
    germany: '#5E6965',
    britain: '#928F7C',
    france: '#4C566F',
    italy: '#626260',
    poland: '#645E4B',
    finland: '#B8B8A0',
    anzac: '#7A5727',
    neutral: '#0c0c0c',
}

const MAIN_NATIONS = ['germany', 'usa', 'britain', 'soviet', 'japan']

/**
 * @param value
 * @returns {boolean}
 */
function isFaction(value) {
    return typeof value === 'string' && FACTIONS.includes(value)
}

/**
 * Dark or light text, whichever reads better on the given faction colour.
 *
 * @param hex
 * @returns {string}
 */
function textColorForBackground(hex) {
    const clean = hex.replace('#', '')
    const r = parseInt(clean.substring(0, 2), 16)
    const g = parseInt(clean.substring(2, 4), 16)
    const b = parseInt(clean.substring(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.58 ? '#111418' : '#f8f9fa'
}

module.exports = {
    FACTIONS,
    FACTION_LABELS,
    FACTION_COLORS,
    MAIN_NATIONS,
    isFaction,
    textColorForBackground,
}
