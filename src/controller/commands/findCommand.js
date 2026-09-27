// The /find panel: a private (ephemeral) message with dropdowns for faction,
// card type, kredits and operation cost, plus a popup for free-text search
// terms. Pressing "Search" composes a /search query (e.g.
// "faction:germany type:tank 5k 1c tiger") and hands it to the regular search
// pipeline, so caching, pagination and attribution all behave identically. The
// faction and type go in as explicit "field:value" filters, which the search
// applies as exact matches instead of looking for the words in card text (see
// hasExactFilters in tools/search.js).
//
// The panel is stateless on the server: the current selection is encoded in
// every component's customId and rebuilt from it on each interaction, so a
// panel keeps working across restarts and needs no Redis entry.
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js')
const {translate} = require('../../tools/translation/translator')
const {FACTIONS: factions, FACTION_LABELS} = require('../../tools/factions')
const {type} = require('../../tools/dictionary')

//copies: sorting in place would reorder the shared dictionary
const FACTIONS = [...factions].sort()
const TYPES = [...type].sort()

const PREFIX = 'find'
const SEPARATOR = ':'
//a customId may hold at most 100 characters. The tightest fit is the results'
//"Next" button: "next_button_" + the longest composed query
//("faction:finland type:countermeasure 12k 6c ") leaves room for this
const TERM_MAX_LENGTH = 40
//the search pipeline rejects shorter queries (discordHandler.js)
const TERM_MIN_LENGTH = parseInt(process.env.MIN_STR_LEN) || 2
//dropdown value that clears the selection; not a valid choice, so
//sanitizeState() turns it back into ''
const ANY = 'any'

//the costs cards actually have (nothing costs 11 kredits)
const KREDITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12']
const OPERATION_COSTS = ['0', '1', '2', '3', '4', '5', '6']

const EMPTY_STATE = {faction: '', type: '', kredits: '', cost: '', term: ''}

/**
 * Encode the panel state into a customId for one of its components.
 *
 * @param action which component (faction, type, kredits, cost, term, reset, go, modal)
 * @param state
 * @returns {string}
 */
function encodeState(action, state)
{
    //the term goes last: it is the only part that may contain the separator
    return [PREFIX, action, state.faction, state.type, state.kredits,
        state.cost, state.term].join(SEPARATOR)
}

/**
 * Decode a customId produced by encodeState.
 *
 * @param customId
 * @returns {{action: string, state: object}|null} null when not a /find id
 */
function decodeState(customId)
{
    if (typeof customId !== 'string') return null
    const parts = customId.split(SEPARATOR)
    if (parts[0] !== PREFIX || parts.length < 7) return null
    const [, action, faction, type, kredits, cost, ...term] = parts

    return {action, state: {faction, type, kredits, cost, term: term.join(SEPARATOR)}}
}

/**
 * Keep a value only if it is one of the allowed choices, so a tampered or
 * outdated customId can't inject arbitrary words into the query.
 *
 * @param value
 * @param allowed
 * @returns {string}
 */
function pick(value, allowed)
{
    return allowed.includes(value) ? value : ''
}

/**
 * Normalise a free-text term: single spaces, no separators, bounded length.
 *
 * @param term
 * @returns {string}
 */
function cleanTerm(term)
{
    //backticks would break the `query` preview on the panel
    return String(term || '')
        .replaceAll(SEPARATOR, ' ')
        .replaceAll('`', '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, TERM_MAX_LENGTH)
        .trim()
}

/**
 * Validate every field of a decoded state.
 *
 * @param state
 * @returns {object}
 */
function sanitizeState(state)
{
    return {
        faction: pick(state.faction, FACTIONS),
        type: pick(state.type, TYPES),
        kredits: pick(state.kredits, KREDITS),
        cost: pick(state.cost, OPERATION_COSTS),
        term: cleanTerm(state.term),
    }
}

/**
 * Compose the /search query for a state: "faction:" and "type:" filters,
 * "5k" for kredits, "1c" for operation cost, then the free text.
 *
 * @param state
 * @returns {string} empty when nothing is selected
 */
function buildQuery(state)
{
    return [
        state.faction && 'faction:' + state.faction,
        state.type && 'type:' + state.type,
        state.kredits && state.kredits + 'k',
        state.cost && state.cost + 'c',
        state.term,
    ].filter(Boolean).join(' ')
}

/**
 * A single-choice dropdown. The first option, "Any", clears the selection.
 *
 * @param action
 * @param state
 * @param placeholder
 * @param anyLabel
 * @param options [{value, label}]
 * @returns {ActionRowBuilder}
 */
function buildSelectRow(action, state, placeholder, anyLabel, options)
{
    const select = new StringSelectMenuBuilder()
        .setCustomId(encodeState(action, state))
        .setPlaceholder(placeholder)
        .setMinValues(0)
        .setMaxValues(1)
        .addOptions([{value: ANY, label: anyLabel}, ...options].map(({value, label}) => ({
            value,
            label,
            default: state[action] === value,
        })))

    return new ActionRowBuilder().addComponents(select)
}

/**
 * Title-case a lowercase keyword for display ("countermeasure" -> "Countermeasure").
 *
 * @param word
 * @returns {string}
 */
function capitalize(word)
{
    return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Build the panel message (content + components) for a state.
 *
 * @param language
 * @param state
 * @returns {{content: string, components: ActionRowBuilder[]}}
 */
function buildFindView(language, state = EMPTY_STATE)
{
    state = sanitizeState(state)
    const t = key => translate(language, key)
    const query = buildQuery(state)

    let content = '**🔎 ' + t('findTitle') + '**\n' + t('findPrompt')
    if (query) content += '\n\n> `' + query + '`'

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(encodeState('term', state))
            .setLabel(t('findTermButton'))
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(encodeState('reset', state))
            .setLabel(t('findReset'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!query),
        new ButtonBuilder()
            .setCustomId(encodeState('go', state))
            .setLabel(t('findSearch'))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!query),
    )

    return {
        content,
        components: [
            buildSelectRow('faction', state, t('findFaction'), t('findAny'),
                FACTIONS.map(value => ({value, label: FACTION_LABELS[value] || value}))),
            buildSelectRow('type', state, t('findType'), t('findAny'),
                TYPES.map(value => ({value, label: capitalize(value)}))),
            buildSelectRow('kredits', state, t('findKredits'), t('findAny'),
                KREDITS.map(value => ({value, label: value + 'K'}))),
            buildSelectRow('cost', state, t('findCost'), t('findAny'),
                OPERATION_COSTS.map(value => ({value, label: value + 'C'}))),
            buttons,
        ],
    }
}

/**
 * The popup for the free-text search term, prefilled with the current one.
 *
 * @param language
 * @param state
 * @returns {ModalBuilder}
 */
function buildTermModal(language, state)
{
    state = sanitizeState(state)
    const input = new TextInputBuilder()
        .setCustomId('term')
        .setLabel(translate(language, 'findModalLabel'))
        .setStyle(TextInputStyle.Short)
        //optional: submitting it empty removes the term
        .setRequired(false)
        .setMinLength(TERM_MIN_LENGTH)
        .setMaxLength(TERM_MAX_LENGTH)
        .setPlaceholder('tiger, blitz, 3/3 …')
    if (state.term) input.setValue(state.term)

    return new ModalBuilder()
        .setCustomId(encodeState('modal', state))
        .setTitle(translate(language, 'findTitle'))
        .addComponents(new ActionRowBuilder().addComponents(input))
}

/**
 * Apply a dropdown change or a submitted term to the state.
 *
 * @param action
 * @param state
 * @param value the selected value ('' when cleared) or the submitted term
 * @returns {object}
 */
function applyChange(action, state, value)
{
    if (action === 'reset') return {...EMPTY_STATE}
    if (action === 'modal') return sanitizeState({...state, term: value})
    if (action in EMPTY_STATE) return sanitizeState({...state, [action]: value})

    return sanitizeState(state)
}

module.exports = {
    buildFindView,
    buildTermModal,
    buildQuery,
    decodeState,
    encodeState,
    applyChange,
    sanitizeState,
    EMPTY_STATE,
    TERM_MAX_LENGTH,
    TERM_MIN_LENGTH,
}
