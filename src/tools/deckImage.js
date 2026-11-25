// Draws the two deck images (deck card + curve, and the card list) with canvas
// and writes them as webp through sharp. The layout mirrors the deck sidebar on
// kards.com/decks; every asset it needs lives in src/assets/deck, and the card
// art comes from kards.com.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const {createCanvas, loadImage, GlobalFonts, Path2D} = require('@napi-rs/canvas')
const {fetchJson} = require('./fetch')
const {getDeckFiles} = require('./fileManager')
const {getCardsDB} = require('../database/db')
const {APILanguages} = require('./language')
const {readDeckCounts} = require('./deckCode')
const {translate} = require('./translation/translator')

const host = 'https://www.kards.com'
const assets = path.join(__dirname, '..', 'assets', 'deck')
//everything is laid out in CSS pixels, then drawn at twice the size
const SCALE = 2
const IMAGE_TIMEOUT = 10000
const API_TIMEOUT = 10000

const fonts = path.join(assets, 'fonts')
GlobalFonts.registerFromPath(path.join(fonts, 'Oswald-Regular.ttf'), 'Oswald')
GlobalFonts.registerFromPath(path.join(fonts, 'Oswald-SemiBold.ttf'), 'Oswald')
GlobalFonts.registerFromPath(path.join(fonts, 'Oswald-Bold.ttf'), 'Oswald')
GlobalFonts.registerFromPath(path.join(fonts, 'SpecialElite-Regular.ttf'), 'Special Elite')
//kards.com sets its kredit numbers in Gotham Narrow, which it never serves, so
//browsers fall back to Segoe UI Bold; Open Sans Bold is the free look-alike
GlobalFonts.registerFromPath(path.join(fonts, 'OpenSans-Bold.ttf'), 'Open Sans')
//none of the faces above has a single CJK glyph; the canvas falls back glyph
//by glyph through the family list, so every font string names these two last:
//Droid for Japanese and both Chinese scripts, NanumSquare for Korean (Droid
//has no hangul at all, Nanum carries all 11,172 syllables)
GlobalFonts.registerFromPath(path.join(fonts, 'DroidSansFallbackFull.ttf'), 'Droid Sans Fallback')
GlobalFonts.registerFromPath(path.join(fonts, 'NanumSquareB.ttf'), 'NanumSquare')

//the nation keys a deck code and the KARDS API use
const NATION_KEYS = {
    1: 'germany', 2: 'britain', 3: 'japan', 4: 'soviet', 5: 'usa', 6: 'france',
    7: 'italy', 8: 'poland', 9: 'finland', 10: 'anzac', 11: 'neutral',
}
//the ids the KARDS API filters cards by (its nations' "id", not their "key")
const NATION_API_IDS = {
    soviet: 1, usa: 2, japan: 3, germany: 4, britain: 5, france: 6,
    italy: 7, poland: 8, finland: 9, anzac: 10, neutral: 11,
}
//a nation's card titles in every language, refreshed after this long
const TITLES_TTL = 12 * 60 * 60 * 1000
const DECK_BACKGROUNDS = {
    usa: 'rgb(67,75,50)', soviet: 'rgb(79,56,38)', britain: 'rgb(133,122,96)',
    germany: 'rgb(90,95,85)', japan: 'rgb(144,114,60)',
}
const COUNTER_BACKGROUNDS = {
    usa: 'rgba(45,51,34,.6)', soviet: 'rgba(55,39,26,.6)',
    britain: 'rgba(72,66,51,.6)', japan: 'rgba(88,70,33,.6)',
}
const ALLY_ICONS = {
    usa: 'nations/nation-army-star.svg', britain: 'nations/nation-british-roundel.svg',
    soviet: 'nations/nation-soviet-sickle.svg', germany: 'nations/nation-germany.svg',
    japan: 'nations/nation-japanese.svg', france: 'nations/nation-france-3.svg',
    italy: 'nations/nation-italy-2.svg', finland: 'nations/nation-finland.svg',
    poland: 'nations/nation-poland.svg', anzac: 'icons/Anzac_ColorOff.svg',
}
const CARD_BACKS = {
    usa: 'UsaBasicB', soviet: 'SovietBasicB', britain: 'BasicBritainB',
    japan: 'JapanBasicB', poland: 'polishBack',
}
const BAR_COLORS = {
    soviet: 'rgb(76,44,15)', usa: 'rgb(79,87,29)', japan: 'rgb(152,113,20)',
    germany: 'rgb(72,83,67)', britain: 'rgb(161,145,112)', france: 'rgb(2,3,72)',
    italy: 'rgb(84,80,71)', poland: 'rgb(100,86,51)', finland: 'rgb(201,200,188)',
}
const RARITIES = ['elite', 'special', 'limited', 'standard']
const RARITY_COLORS = {
    elite: '#BC7B35', special: '#A3A3A3', limited: '#8C7054', standard: '#6D6D6D',
}
const COUNT_COLORS = {
    elite: 'rgb(198,132,46)', special: 'rgb(163,163,163)', limited: 'rgb(175,126,84)',
}
//the wildcard icons from the deck sidebar, viewBox 0 0 15 20
const LIMITED_OUTER = 'M14.7456 1.24428V1.24587V18.7497C14.7456 19.3001 14.3008 19.7456 13.7587 19.7456H1.23689C0.694844 19.7456 0.25 19.3001 0.25 18.7497V1.24587C0.25 0.695464 0.694844 0.25 1.23689 0.25H13.7587C14.306 0.25 14.7491 0.695995 14.7456 1.24428Z'
const WILDCARD_PATHS = {
    elite: [
        'M14.7354 1.24847V1.25006V18.6618C14.7354 19.2078 14.2924 19.6511 13.751 19.6511H1.25486C0.713455 19.6511 0.270508 19.2078 0.270508 18.6618V1.25006C0.270508 0.704025 0.713455 0.260742 1.25486 0.260742H13.7554C14.2976 0.260742 14.7388 0.700175 14.7354 1.24847Z',
        'M10.964 8.49241C9.32839 7.03852 8.47351 6.31595 7.53575 4.26648C6.57619 6.30281 5.71694 7.01662 4.06823 8.453C1.49486 10.6952 2.90367 13.6511 4.90567 13.8044C6.15311 13.9007 6.9164 12.9198 7.26969 12.3067C7.15629 13.1387 6.92512 14.6233 6.63725 15.2889L8.33393 15.2977C8.05479 14.6321 7.83671 13.1431 7.73203 12.3067C8.0766 12.9242 8.83116 13.9139 10.0786 13.835C12.085 13.7037 13.5199 10.7652 10.964 8.49241Z',
    ],
    special: [
        'M0.250026 1.24428V1.24587V18.7541C0.250026 19.3045 0.694963 19.75 1.23727 19.75H13.7628C14.3051 19.75 14.75 19.3045 14.75 18.7541V1.24587C14.75 0.695533 14.3051 0.25 13.7628 0.25H1.23727C0.689715 0.25 0.246531 0.696063 0.250026 1.24428Z',
        'M6.00961 3.83897C7.05419 3.87419 7.49125 4.80309 7.49125 4.80309 7.49125 4.80309 7.9458 3.88299 8.99038 3.86098 10.1093 3.83897 10.6031 5.81124 9.52797 7.36527 8.75436 8.48348 7.94143 9.0734 7.4694 9.39477 6.99737 9.06459 6.22377 8.45706 5.46328 7.32565 4.40122 5.75841 4.89073 3.79935 6.00961 3.83897zM6.00961 10.6009C7.05419 10.6362 7.49125 11.5651 7.49125 11.5651 7.49125 11.5651 7.9458 10.645 8.99038 10.6229 10.1093 10.6009 10.6031 12.5732 9.52797 14.1272 8.75436 15.2454 7.94143 15.8354 7.4694 16.1567 6.99737 15.8266 6.22377 15.219 5.46328 14.0876 4.40122 12.5204 4.89073 10.5613 6.00961 10.6009z',
    ],
    limited: [
        LIMITED_OUTER,
        'M5.28417 2.92761C5.28417 2.92761 4.44938 4.36719 3.27368 5.63067 4.51494 6.84133 5.42403 8.24128 5.42403 8.24128 5.42403 8.24128 6.25882 6.8017 7.43452 5.53822 6.19326 4.32757 5.28417 2.92761 5.28417 2.92761zM7.38183 7.34314C7.38183 7.34314 6.54704 8.78272 5.37134 10.0462 6.6126 11.2569 7.52169 12.6568 7.52169 12.6568 7.52169 12.6568 8.35648 11.2172 9.53218 9.95375 8.29092 8.7431 7.38183 7.34314 7.38183 7.34314zM9.57592 11.7587C9.57592 11.7587 8.74113 13.1982 7.56543 14.4617 8.80669 15.6724 9.71578 17.0723 9.71578 17.0723 9.71578 17.0723 10.5506 15.6328 11.7263 14.3693 10.485 13.1586 9.57592 11.7587 9.57592 11.7587z',
    ],
    standard: [
        LIMITED_OUTER,
        [[4.7, 6.6], [10.2, 6.6], [4.7, 13.3], [10.2, 13.3]]
            .map(([x, y]) => `M${x + 1.3} ${y}A1.3 1.3 0 1 1 ${x - 1.3} ${y}A1.3 1.3 0 1 1 ${x + 1.3} ${y}Z`)
            .join(''),
    ],
}
const TITLES_QUERY = `query titles($nationIds: [Int]) {
  cards(first: 2000, nationIds: $nationIds, showSpawnables: true, showReserved: true, showExiles: true) {
    edges { node { importId json } }
  }
}`
const DECK_QUERY = `query deck($slug: String!, $language: String!) {
  deck(slug: $slug) {
    name
    user { username }
    featuredCard { image(type: tiny, language: $language) }
    mainNation { key }
    allyNation { key }
    cards { edges { node { json importId thumb: image(type: thumb, language: $language) } } }
  }
}`

/**
 * Draw both deck images for a deck code or a kards.com deck link and save
 * them under the getDeckFiles(filename) paths.
 *
 * @param input a deck code (URL-encoded or not) or a kards.com deck link
 * @param language the bot language, e.g. 'de'
 * @param filename the base name getDeckFiles() turns into the two paths
 * @returns {Promise<boolean>} false when the deck could not be read
 */
async function renderDeckImages(input, language, filename) {
    const deck = await loadDeck(input, language)
    if (!deck || !deck.cards.length) return false
    deck.language = language

    const [first, second] = getDeckFiles(filename)
    const [overview, list] = await Promise.all([drawOverview(deck), drawList(deck)])
    await Promise.all([
        sharp(overview).webp({quality: 95}).toFile(first),
        sharp(list).webp({quality: 95}).toFile(second),
    ])

    return true
}

// ---------------------------------------------------------------- deck data

/**
 * @param input
 * @param language
 * @returns {Promise<object|false>}
 */
async function loadDeck(input, language) {
    const apiLanguage = APILanguages[language] || 'en-EN'
    input = input.trim()
    if (!input.startsWith('http')) return loadCodeDeck(input, apiLanguage)

    let url
    try {
        url = new URL(input)
    } catch {
        return false
    }
    //the builder carries its deck code in the hash parameter
    const hash = url.searchParams.get('hash')
    if (hash) return loadCodeDeck(hash, apiLanguage)

    const slug = url.pathname.match(/\/decks\/([^/?#]+)/)?.[1]
    if (!slug || slug === 'deck-builder') return false

    return loadLinkDeck(decodeURIComponent(slug), apiLanguage)
}

/**
 * @param code
 * @param apiLanguage
 * @returns {Promise<object|false>}
 */
async function loadCodeDeck(code, apiLanguage) {
    const parsed = parseDeckCode(code)
    if (!parsed) return false

    const counts = readDeckCounts(parsed.cards)
    if (!counts.size) return false

    //the database only keeps the English titles
    const [rows, titles] = await Promise.all([
        getCardsDB({importId: {in: [...counts.keys()]}}),
        apiLanguage === 'en-EN'
            ? new Map()
            : loadTitles([parsed.main, parsed.ally]),
    ])
    //importId is not unique: a reprint comes back under a second cardId
    const seen = new Set()
    const cards = []
    for (const row of rows) {
        if (seen.has(row.importId)) continue
        seen.add(row.importId)
        cards.push({
            importId: row.importId,
            title: titles.get(row.importId)?.[apiLanguage] || row.title,
            type: row.type,
            kredits: row.kredits,
            operationCost: row.operationCost,
            rarity: (row.rarity || '').toLowerCase(),
            faction: (row.faction || '').toLowerCase(),
            exile: row.exile ? row.exile.toLowerCase() : null,
            reserved: !!row.reserved,
            imageURL: localise(row.imageURL, apiLanguage),
            thumbURL: localise(row.thumbURL, apiLanguage),
            count: counts.get(row.importId),
        })
    }

    const deck = buildDeck({
        name: null,
        user: null,
        main: parsed.main,
        ally: parsed.ally,
        cards,
    })
    deck.featuredURL = pickFeatured(deck.cards)?.imageURL || null

    return deck
}

//nation -> {fetched, titles: Map(importId -> {locale: title})}
const titleCache = new Map()

/**
 * Every card title of the given nations in all languages, keyed by importId.
 * One API call per nation, kept in memory; a failed call just leaves those
 * cards on their English database titles.
 *
 * @param nations nation keys, e.g. ['germany', 'soviet']
 * @returns {Promise<Map<string, object>>}
 */
async function loadTitles(nations) {
    const titles = new Map()
    await Promise.all([...new Set(nations)].map(async nation => {
        const id = NATION_API_IDS[nation]
        if (!id) return
        let entry = titleCache.get(nation)
        if (!entry || Date.now() - entry.fetched > TITLES_TTL) {
            const fetched = await fetchNationTitles(id)
            if (!fetched) return
            entry = {fetched: Date.now(), titles: fetched}
            titleCache.set(nation, entry)
        }
        for (const [importId, title] of entry.titles) titles.set(importId, title)
    }))

    return titles
}

/**
 * @param nationId
 * @returns {Promise<Map<string, object>|null>}
 */
async function fetchNationTitles(nationId) {
    const apiURL = process.env.KARDS_API_URL || 'https://herokuapi.kards.com/graphql'
    const response = await fetchJson(apiURL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: TITLES_QUERY, variables: {nationIds: [nationId]}}),
        signal: AbortSignal.timeout(API_TIMEOUT),
    }).catch(error => console.error('card titles request to kards.com failed', error?.message))

    const edges = response?.data?.data?.cards?.edges
    if (!edges) return null
    const titles = new Map()
    for (const {node} of edges) {
        if (node.json?.title) titles.set(node.importId, node.json.title)
    }

    return titles
}

/**
 * @param slug
 * @param apiLanguage
 * @returns {Promise<object|false>}
 */
async function loadLinkDeck(slug, apiLanguage) {
    const apiURL = process.env.KARDS_API_URL || 'https://herokuapi.kards.com/graphql'
    const response = await fetchJson(apiURL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: DECK_QUERY, variables: {slug, language: apiLanguage}}),
        signal: AbortSignal.timeout(API_TIMEOUT),
    }).catch(error => console.error('deck request to kards.com failed', error?.message))

    const data = response?.data?.data?.deck
    if (!data) return false

    //the API lists one edge per copy
    const byId = new Map()
    for (const {node} of data.cards?.edges || []) {
        const existing = byId.get(node.importId)
        if (existing) {
            existing.count++
            continue
        }
        const json = node.json || {}
        byId.set(node.importId, {
            importId: node.importId,
            title: json.title?.[apiLanguage] || json.title?.['en-EN'] || '',
            type: json.type,
            kredits: json.kredits ?? 0,
            operationCost: json.operationCost ?? null,
            rarity: (json.rarity || '').toLowerCase(),
            faction: (json.faction || '').toLowerCase(),
            exile: json.exile ? String(json.exile).toLowerCase() : null,
            reserved: !!json.reserved,
            imageURL: null,
            thumbURL: node.thumb,
            count: 1,
        })
    }

    const deck = buildDeck({
        name: data.name || null,
        user: data.user?.username || null,
        main: NATION_KEYS[data.mainNation?.key],
        ally: NATION_KEYS[data.allyNation?.key],
        cards: [...byId.values()],
    })
    //the featured card comes as a tiny image; the full one sits a folder up
    deck.featuredURL = data.featuredCard?.image?.replace('/tiny/', '/') || null

    return deck
}

/**
 * Read the nations and the card groups out of a deck code. Codes arrive
 * URL-encoded more often than not (%25%25, %7C, %3B), so decode first.
 *
 * @param code
 * @returns {{main: string, ally: string, cards: string}|null}
 */
function parseDeckCode(code) {
    try {
        code = decodeURIComponent(code)
    } catch {
        //a lone % is fine in a raw code, it only breaks the decoding
    }
    const match = /(?:%%)?(?<main>\d)(?<ally>\d+|a)\|(?<cards>\S*)/.exec(code)
    if (!match) return null

    const {main, ally, cards} = match.groups
    const allyKey = ally === 'a' ? 10 : parseInt(ally)
    if (!NATION_KEYS[main] || !NATION_KEYS[allyKey]) return null

    return {main: NATION_KEYS[main], ally: NATION_KEYS[allyKey], cards}
}

/**
 * Sort the cards and work out the counts the sidebar shows.
 *
 * @returns {object}
 */
function buildDeck({name, user, main, ally, cards}) {
    //stable: cards with the same cost keep the order they came in
    cards.sort((a, b) => a.kredits - b.kredits)

    let total = 1 //the headquarters
    let mainCount = 1
    let allyCount = 0
    const curve = new Array(8).fill(0)
    const wildcards = {elite: 0, special: 0, limited: 0, standard: 0}

    for (const card of cards) {
        total += card.count
        if (card.faction === main || (card.exile === main && card.exile !== ally)) {
            mainCount += card.count
        }
        if ((card.faction === ally && card.exile !== main) || card.exile === ally) {
            allyCount += card.count
        }
        curve[Math.min(Math.max(card.kredits, 0), 7)] += card.count
        if (card.rarity in wildcards) wildcards[card.rarity] += card.count
    }

    return {name, user, main, ally, cards, total, mainCount, allyCount, curve, wildcards}
}

/**
 * The card a code deck is shown with: its rarest card, the priciest of those.
 *
 * @param cards
 * @returns {object|undefined}
 */
function pickFeatured(cards) {
    const rank = rarity => {
        const index = RARITIES.indexOf(rarity)
        return index === -1 ? RARITIES.length : index
    }

    return [...cards]
        .filter(card => card.imageURL)
        .sort((a, b) => rank(a.rarity) - rank(b.rarity) || b.kredits - a.kredits)[0]
}

/**
 * @param url
 * @param apiLanguage
 * @returns {string|null}
 */
function localise(url, apiLanguage) {
    return url ? url.replace('en-EN', apiLanguage) : null
}

// ---------------------------------------------------------------- images

//decoded card art, keyed by url and size; deck after deck reuses the same thumbs
const imageCache = new Map()
const IMAGE_CACHE_LIMIT = 400

/**
 * Fetch a kards.com image (AVIF, which canvas cannot decode) and hand it back
 * as a canvas image, scaled with sharp to the size it is drawn at.
 *
 * @param url relative kards.com path
 * @param width
 * @param height
 * @returns {Promise<import('@napi-rs/canvas').Image|null>}
 */
async function loadRemoteImage(url, width, height) {
    if (!url) return null

    const key = `${url}@${width}x${height}`
    let png = imageCache.get(key)
    if (!png) {
        try {
            const response = await fetch(host + url, {signal: AbortSignal.timeout(IMAGE_TIMEOUT)})
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const source = Buffer.from(await response.arrayBuffer())
            png = await sharp(source)
                .resize(Math.round(width * SCALE), Math.round(height * SCALE), {fit: 'cover'})
                .png()
                .toBuffer()
        } catch (error) {
            console.error('Failed to load deck image', url, error?.message)
            return null
        }
        imageCache.set(key, png)
        if (imageCache.size > IMAGE_CACHE_LIMIT) {
            imageCache.delete(imageCache.keys().next().value)
        }
    } else {
        //refresh its place so the most used art stays cached
        imageCache.delete(key)
        imageCache.set(key, png)
    }

    return loadImage(png)
}

//the bundled assets never change, so each is decoded once
const assetCache = new Map()

/**
 * @param file path inside src/assets/deck
 * @returns {Promise<import('@napi-rs/canvas').Image|null>}
 */
async function loadAsset(file) {
    if (!file) return null
    if (!assetCache.has(file)) {
        assetCache.set(file, loadImage(fs.readFileSync(path.join(assets, file))).catch(error => {
            console.error('Failed to load deck asset', file, error?.message)
            return null
        }))
    }

    return assetCache.get(file)
}

/**
 * @param nation
 * @returns {string|null}
 */
function nationIcon(nation) {
    if (nation === 'anzac') return 'icons/Anzac_ColorOff.svg'
    if (!nation || nation === 'neutral') return null

    return `icons/${nation}.svg`
}

// ---------------------------------------------------------------- drawing

//the sidebar card's size on kards.com at a 1024px wide viewport
const CARD_WIDTH = 305
const CARD_HEIGHT = 221
const PAGE_BACKGROUND = 'rgb(24,24,24)'

/**
 * @param width CSS pixels
 * @param height CSS pixels
 * @returns {{canvas, ctx}}
 */
function newCanvas(width, height) {
    const canvas = createCanvas(Math.round(width * SCALE), Math.round(height * SCALE))
    const ctx = canvas.getContext('2d')
    ctx.scale(SCALE, SCALE)

    return {canvas, ctx}
}

/**
 * The page background behind the sidebar: the paper pattern on near-black.
 */
async function drawPageBackground(ctx, width, height) {
    ctx.fillStyle = PAGE_BACKGROUND
    ctx.fillRect(0, 0, width, height)
    const pattern = await loadAsset('misc/pattern.jpg')
    if (pattern) {
        ctx.save()
        //the pattern is drawn at 1x on the site, so undo the canvas scale for it
        ctx.scale(1 / SCALE, 1 / SCALE)
        ctx.fillStyle = ctx.createPattern(pattern, 'repeat')
        ctx.fillRect(0, 0, width * SCALE, height * SCALE)
        ctx.restore()
    }
}

/**
 * Image 1: the deck card on top, the kredit curve below it.
 *
 * @param deck
 * @returns {Promise<Buffer>} png
 */
async function drawOverview(deck) {
    const margin = 10
    //the site hangs the curve 20px under the deck card
    const curveTop = margin + CARD_HEIGHT + 20
    const width = CARD_WIDTH + 2 * margin
    const height = Math.ceil(curveTop + CURVE_HEIGHT + margin)
    const {canvas, ctx} = newCanvas(width, height)
    await drawPageBackground(ctx, width, height)
    await drawDeckCard(ctx, deck, margin, margin)
    drawCurve(ctx, deck.curve, margin, curveTop)

    return canvas.encode('png')
}

/**
 * The deck card from the sidebar, CARD_WIDTH x CARD_HEIGHT at (x, y).
 */
async function drawDeckCard(ctx, deck, x, y) {
    const [emblem, mainIcon, allyIcon, featured, back] = await Promise.all([
        DECK_BACKGROUNDS[deck.main] ? loadAsset(`nations/emblem_${deck.main}.svg`) : null,
        loadAsset(nationIcon(deck.main)),
        loadAsset(ALLY_ICONS[deck.ally]),
        loadRemoteImage(deck.featuredURL, 90, 90 * 1.40568),
        loadAsset(`backs/${CARD_BACKS[deck.main] || 'BasicGermanB'}.jpg`),
    ])

    ctx.save()
    ctx.translate(x, y)
    ctx.beginPath()
    ctx.rect(0, 0, CARD_WIDTH, CARD_HEIGHT)
    ctx.clip()

    //background and the faint nation emblem
    ctx.fillStyle = DECK_BACKGROUNDS[deck.main] || 'rgb(68,68,68)'
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
    if (emblem) {
        ctx.save()
        ctx.globalAlpha = 0.045
        drawContained(ctx, emblem, 0, 0, CARD_WIDTH, CARD_HEIGHT)
        ctx.restore()
    }

    //header: nation icon, deck name, author
    if (mainIcon) drawContained(ctx, mainIcon, 15, 15, 35, 35)
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.font = '600 20px Oswald, "Droid Sans Fallback", NanumSquare'
    ctx.fillStyle = 'rgb(222,219,197)'
    const name = deck.name || translate(deck.language, 'deck_untitled')
    ctx.fillText(ellipsize(ctx, name.toUpperCase(), CARD_WIDTH - 63 - 15), 63, 12)
    ctx.font = '600 12px Oswald, "Droid Sans Fallback", NanumSquare'
    if (deck.user) {
        //the author is an underlined link on the site
        const user = ellipsize(ctx, deck.user, CARD_WIDTH - 63 - 15)
        const baseline = 41 + ctx.measureText('H').actualBoundingBoxDescent
        ctx.fillStyle = 'rgb(219,161,34)'
        ctx.fillText(user, 63, 41)
        ctx.fillRect(63, baseline + 1.5, ctx.measureText(user).width, 1)
    } else {
        ctx.fillStyle = 'rgb(196,196,196)'
        ctx.fillText(translate(deck.language, 'deck_wip'), 63, 41)
    }

    //content band: ally icon, nations with their counts, the card counter
    ctx.fillStyle = 'rgba(48,48,48,.75)'
    ctx.fillRect(0, 87, CARD_WIDTH, 95)
    if (allyIcon) drawContained(ctx, allyIcon, 22, 87 + (95 - 24) / 2, 24, 24)

    drawNationLine(ctx, nationLabel(deck, deck.main), deck.mainCount, 65, 92, 16)
    drawNationLine(ctx, nationLabel(deck, deck.ally), deck.allyCount, 65, 113, 12)

    ctx.font = '600 28px Oswald, "Droid Sans Fallback", NanumSquare'
    const counter = `${deck.total}/40`
    const counterWidth = ctx.measureText(counter).width
    if (COUNTER_BACKGROUNDS[deck.main]) {
        ctx.fillStyle = COUNTER_BACKGROUNDS[deck.main]
        ctx.fillRect(60, 137, counterWidth + 10, 38)
    }
    ctx.fillStyle = 'rgb(222,219,197)'
    ctx.fillText(counter, 65, 137)

    //two cards fanned out: the nation's card back behind the featured card.
    //The site centres the pair in the card's right half and shifts them with
    //translate(-25%,-55%) and, for the back, translate(-75%,-40%) scale(.9)
    const cardWidth = 90
    const cardHeight = cardWidth * 1.40568
    const fanX = CARD_WIDTH * 0.75
    if (back) drawCard(ctx, back, fanX - cardWidth / 4, 146.75, cardWidth * 0.9, cardHeight * 0.9, -8)
    drawCard(ctx, featured || back, fanX + cardWidth / 4, 127.8, cardWidth, cardHeight, 8)

    //footer: wildcards by rarity
    ctx.font = 'bold 14px Oswald, "Droid Sans Fallback", NanumSquare'
    ctx.textBaseline = 'middle'
    RARITIES.forEach((rarity, index) => {
        const iconX = 15 + index * 35
        drawWildcard(ctx, rarity, iconX, 191)
        ctx.fillStyle = 'rgb(222,219,197)'
        ctx.fillText(String(deck.wildcards[rarity]), iconX + 20, 201)
    })

    //the light inset frame
    ctx.strokeStyle = 'rgba(235,235,219,.7)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2)
    ctx.restore()
}

/**
 * @param deck
 * @param nation
 * @returns {string} the nation's name in the deck's language, upper case
 */
function nationLabel(deck, nation) {
    return nation ? translate(deck.language, 'nation_' + nation).toUpperCase() : ''
}

/**
 * "Germany 27": the nation in semi-bold, its card count in grey. The site sets
 * the main nation at 16px and the ally smaller, at 12px.
 */
function drawNationLine(ctx, label, count, x, y, size) {
    ctx.textBaseline = 'top'
    ctx.font = `600 ${size}px Oswald, "Droid Sans Fallback", NanumSquare`
    ctx.fillStyle = 'rgb(222,219,197)'
    ctx.fillText(label, x, y)
    const labelWidth = ctx.measureText(label).width
    ctx.font = `${size}px Oswald, "Droid Sans Fallback", NanumSquare`
    ctx.fillStyle = 'rgb(196,196,196)'
    ctx.fillText(String(count), x + labelWidth + size * 0.375, y)
}

/**
 * The site's kredit cost badge, drawn in its own 38 x 34 viewBox: a big
 * digit, a small gold K raised to its right and an optional second value
 * (the operation cost, or the "+" of 7+K) beside the digit's baseline.
 *
 * @param ctx already translated and scaled to the badge's box
 * @param primary
 * @param secondary
 * @param large whether the second value is the larger "+" of the curve
 */
function drawCost(ctx, primary, secondary = '', large = false) {
    ctx.save()
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'right'
    ctx.font = 'bold 26px "Open Sans", "Droid Sans Fallback", NanumSquare'
    ctx.fillStyle = 'rgb(235,235,220)'
    ctx.letterSpacing = '-3px'
    ctx.fillText(String(primary), 22, 26)

    ctx.textAlign = 'left'
    if (secondary !== '') {
        const size = large ? 17 : 10
        ctx.font = `bold ${size}px "Open Sans", "Droid Sans Fallback", NanumSquare`
        ctx.letterSpacing = `${-size / 10}px`
        ctx.fillText(String(secondary), large ? 24 : 26, 26)
    }
    ctx.font = 'bold 10px "Open Sans", "Droid Sans Fallback", NanumSquare'
    ctx.letterSpacing = '-1px'
    ctx.fillStyle = 'rgb(219,160,34)'
    ctx.fillText('K', 26, 14)
    ctx.restore()
}

/**
 * One card, rotated about its centre, with the site's drop shadow.
 */
function drawCard(ctx, image, centerX, centerY, width, height, degrees) {
    if (!image) return
    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(degrees * Math.PI / 180)
    ctx.shadowColor = 'rgba(0,0,0,.5)'
    ctx.shadowOffsetY = 3.5 * SCALE
    ctx.shadowBlur = 6 * SCALE
    ctx.drawImage(image, -width / 2, -height / 2, width, height)
    ctx.restore()
}

/**
 * A 15 x 20 wildcard icon at (x, y).
 */
function drawWildcard(ctx, rarity, x, y) {
    const [outer, inner] = WILDCARD_PATHS[rarity]
    ctx.save()
    ctx.translate(x, y)
    const outline = new Path2D(outer)
    ctx.fillStyle = RARITY_COLORS[rarity]
    ctx.fill(outline)
    ctx.strokeStyle = '#dedbc5'
    ctx.lineWidth = 1
    ctx.stroke(outline)
    ctx.fillStyle = '#1F1D1A'
    ctx.fill(new Path2D(inner))
    ctx.restore()
}

//the curve sits 21.6px in from the deck card's sides on the site, and its box
//is half as high as it is wide
const CURVE_INSET = 21.6
const CURVE_WIDTH = CARD_WIDTH - 2 * CURVE_INSET
const CURVE_COUNT_ROW = 30
const CURVE_GAP = 2
const CURVE_COLUMNS_HEIGHT = CURVE_WIDTH / 2 - 2 * CURVE_COUNT_ROW
const CURVE_KREDIT_ROW = 30
const CURVE_HEIGHT = CURVE_COUNT_ROW + CURVE_COLUMNS_HEIGHT + CURVE_GAP + CURVE_KREDIT_ROW

/**
 * The kredit curve: eight columns, 0K to 7+K, at (x, y), laid out like the
 * site: every count on one row above the columns (none for an empty column),
 * the bars below it and a boxed kredit badge under each column.
 */
function drawCurve(ctx, curve, x, y) {
    const left = x + CURVE_INSET
    const columnWidth = (CURVE_WIDTH - 7 * CURVE_GAP) / 8
    const columnTop = y + CURVE_COUNT_ROW
    const columnBottom = columnTop + CURVE_COLUMNS_HEIGHT
    const kreditTop = columnBottom + CURVE_GAP
    const border = 1.6
    const highest = Math.max(1, ...curve)

    ctx.save()
    curve.forEach((count, index) => {
        const columnX = left + index * (columnWidth + CURVE_GAP)
        ctx.fillStyle = 'rgba(255,255,255,.05)'
        ctx.fillRect(columnX, columnTop, columnWidth, CURVE_COLUMNS_HEIGHT)

        const barHeight = count / highest * CURVE_COLUMNS_HEIGHT
        if (barHeight) {
            ctx.fillStyle = 'rgb(191,191,170)'
            ctx.fillRect(columnX, columnBottom - barHeight, columnWidth, barHeight)
        }

        if (count) {
            ctx.save()
            ctx.font = '12px "Special Elite"'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = 'rgb(235,235,220)'
            ctx.shadowColor = 'rgba(0,0,0,.8)'
            ctx.shadowOffsetX = SCALE
            ctx.shadowOffsetY = SCALE
            ctx.fillText(`${count}x`, columnX + columnWidth / 2, y + CURVE_COUNT_ROW / 2)
            ctx.restore()
        }

        //the kredit box: a light border around a dark inset holding the badge
        ctx.fillStyle = 'rgb(191,191,170)'
        ctx.fillRect(columnX, kreditTop, columnWidth, CURVE_KREDIT_ROW)
        const innerWidth = columnWidth - 2 * border
        const innerHeight = CURVE_KREDIT_ROW - 2 * border
        ctx.fillStyle = 'rgb(17,19,23)'
        ctx.fillRect(columnX + border, kreditTop + border, innerWidth, innerHeight)

        //the badge's 38 x 34 viewBox, contained in the inset
        const badgeScale = Math.min(innerWidth / 38, innerHeight / 34)
        ctx.save()
        ctx.translate(columnX + border + (innerWidth - 38 * badgeScale) / 2,
            kreditTop + border + (innerHeight - 34 * badgeScale) / 2)
        ctx.scale(badgeScale, badgeScale)
        drawCost(ctx, index, index === 7 ? '+' : '', true)
        ctx.restore()
    })
    ctx.restore()
}

/**
 * Image 2: one row per card, the way the sidebar lists them.
 *
 * @param deck
 * @returns {Promise<Buffer>} png
 */
async function drawList(deck) {
    const rowLeft = 5
    const width = 340
    const height = deck.cards.length * 40 + 5
    const {canvas, ctx} = newCanvas(width, height)
    await drawPageBackground(ctx, width, height)
    ctx.fillStyle = 'rgba(0,0,0,.2)'
    ctx.fillRect(0, 0, width, height)

    const dirt = await loadAsset('misc/dirt.png')
    const rows = await Promise.all(deck.cards.map(card => Promise.all([
        loadRemoteImage(card.thumbURL, 38, 34),
        loadAsset(nationIcon(card.faction)),
    ])))

    deck.cards.forEach((card, index) => {
        const [thumb, icon] = rows[index]
        drawRow(ctx, card, rowLeft, 4 + index * 40, {thumb, icon, dirt})
    })

    return canvas.encode('png')
}

/**
 * One 280 x 38 card row at (x, y), plus its "2x" count to the right.
 */
function drawRow(ctx, card, x, y, {thumb, icon, dirt}) {
    ctx.save()
    ctx.translate(x, y)

    ctx.fillStyle = 'rgb(191,191,170)'
    ctx.fillRect(0, 0, 280, 38)

    //kredits box
    ctx.fillStyle = 'rgb(17,19,23)'
    ctx.fillRect(2, 2, 34, 34)
    const hasOperationCost = isUnit(card) && card.operationCost !== null && card.operationCost !== undefined
    ctx.save()
    ctx.translate(2, 2)
    drawCost(ctx, card.kredits, hasOperationCost ? card.operationCost : '')
    ctx.restore()

    //nation bar with the name and the nation icon
    ctx.fillStyle = BAR_COLORS[card.faction] || 'rgb(52,52,52)'
    ctx.fillRect(38, 2, 202, 34)
    if (dirt) drawCovered(ctx, dirt, 38, 2, 202, 34)
    const shade = ctx.createLinearGradient(38, 0, 240, 0)
    shade.addColorStop(0, 'rgba(0,0,0,0)')
    shade.addColorStop(1, 'rgba(0,0,0,.25)')
    ctx.fillStyle = shade
    ctx.fillRect(38, 2, 202, 34)

    ctx.font = '600 16px Oswald, "Droid Sans Fallback", NanumSquare'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = card.faction === 'finland' ? 'rgb(50,50,50)' : 'rgb(235,235,220)'
    ctx.fillText(ellipsize(ctx, card.title, 202 - 38 - 12), 44, 19)
    if (icon) drawContained(ctx, icon, 202 + 38 * 0.2, 2 + (34 - 38 * 0.6) / 2, 38 * 0.6, 38 * 0.6)

    if (card.reserved) {
        //a gold corner marks reserved cards
        ctx.fillStyle = 'rgb(219,161,34)'
        ctx.beginPath()
        ctx.moveTo(38, 2)
        ctx.lineTo(48, 2)
        ctx.lineTo(38, 12)
        ctx.closePath()
        ctx.fill()
    }

    if (thumb) ctx.drawImage(thumb, 240, 2, 38, 34)

    //copies
    ctx.font = 'bold 18px Oswald, "Droid Sans Fallback", NanumSquare'
    ctx.textAlign = 'center'
    ctx.fillStyle = COUNT_COLORS[card.rarity] || 'rgb(127,127,127)'
    ctx.fillText(`${card.count}x`, 292 + 19, 19)

    ctx.restore()
}

/**
 * @param card
 * @returns {boolean}
 */
function isUnit(card) {
    return card.type !== 'order' && card.type !== 'countermeasure'
}

/**
 * Shorten text with an ellipsis until it fits maxWidth.
 */
function ellipsize(ctx, text, maxWidth) {
    text = text || ''
    if (ctx.measureText(text).width <= maxWidth) return text
    while (text.length && ctx.measureText(text + '…').width > maxWidth) {
        text = text.slice(0, -1)
    }

    return text.trimEnd() + '…'
}

/**
 * Draw an image inside a box, keeping its aspect ratio (CSS contain).
 */
function drawContained(ctx, image, x, y, width, height) {
    const ratio = Math.min(width / image.width, height / image.height)
    const drawWidth = image.width * ratio
    const drawHeight = image.height * ratio
    ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

/**
 * Draw an image filling a box, cropping the overflow (CSS cover).
 */
function drawCovered(ctx, image, x, y, width, height) {
    const ratio = Math.max(width / image.width, height / image.height)
    const sourceWidth = width / ratio
    const sourceHeight = height / ratio
    ctx.drawImage(image,
        (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2, sourceWidth, sourceHeight,
        x, y, width, height)
}

module.exports = {renderDeckImages, loadDeck, parseDeckCode, buildDeck, pickFeatured}
