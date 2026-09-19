// Unit tests for the shared command log line used by both the Discord and the
// Telegram handler. Pure formatting, so nothing is mocked.

const {
    fmtMs,
    formatCommandLog,
    formatPage,
    discordActor,
    telegramActor,
    setLog,
    addTiming,
    logCommand,
} = require('../src/tools/commandLog')

// The segments are padded for column alignment, so tests compare on the
// trimmed fields rather than on the raw spacing.
function segments(line) {
    return line.split(' · ').map(part => part.trim())
}

describe('fmtMs', () => {
    test('keeps one decimal for sub-10ms lookups', () => {
        expect(fmtMs(4.23)).toBe('4.2ms')
    })

    test('rounds to whole milliseconds above 10ms', () => {
        expect(fmtMs(2113.7)).toBe('2114ms')
    })

    test('renders a missing measurement as a question mark', () => {
        expect(fmtMs(null)).toBe('?')
        expect(fmtMs(undefined)).toBe('?')
    })

    test('does not swallow a zero measurement', () => {
        expect(fmtMs(0)).toBe('0.0ms')
    })
})

describe('formatPage', () => {
    test('the first page carries no offset', () => {
        expect(formatPage(0, 5)).toBe('p1')
    })

    test('later pages carry the raw offset so a click can be traced', () => {
        expect(formatPage(5, 5)).toBe('p2 off5')
        expect(formatPage(20, 10)).toBe('p3 off20')
    })

    test('falls back to page one without a limit', () => {
        expect(formatPage(10, 0)).toBe('p1')
    })
})

describe('discordActor', () => {
    test('tags a slash command and names the guild channel', () => {
        const actor = discordActor({
            message: {isSlash: true, authorName: 'rainy'},
            guildName: 'KARDS', channelName: 'general',
        })

        expect(actor).toEqual({
            src: 'dc/slash', who: 'rainy', where: 'KARDS#general', id: undefined,
        })
    })

    test('tags a button press', () => {
        const actor = discordActor({
            message: {buttonId: 'next_button_alt10', authorName: 'rainy'},
            guildName: 'KARDS', channelName: 'general',
        })

        expect(actor.src).toBe('dc/button')
    })

    test('a plain message with no guild is a DM', () => {
        const actor = discordActor({message: {author: {username: 'rainy'}}})

        expect(actor).toEqual({
            src: 'dc/text', who: 'rainy', where: 'DM', id: undefined,
        })
    })

    test('carries the Discord message id', () => {
        expect(discordActor({message: {id: '1284003921730801665'}}).id)
            .toBe('1284003921730801665')
    })

    test('an unknown author does not break the line', () => {
        expect(discordActor({message: {}}).who).toBe('unknown')
        expect(discordActor({}).who).toBe('unknown')
    })
})

describe('telegramActor', () => {
    test('reads the sender off a text command', () => {
        const actor = telegramActor({
            tgCtx: {update: {message: {from: {username: 'alex'}}}},
            chatName: 'KARDS chat',
        })

        expect(actor).toEqual({
            src: 'tg/text', who: 'alex', where: 'KARDS chat', id: undefined,
        })
    })

    // A button tap carries the sender on callbackQuery, not on the message.
    test('reads the sender off a button tap', () => {
        const actor = telegramActor({
            tgCtx: {
                callbackQuery: {from: {username: 'alex'}, data: 'profile_show'},
                chat: {title: 'KARDS chat'},
            },
        })

        expect(actor).toEqual({
            src: 'tg/button', who: 'alex', where: 'KARDS chat', id: undefined,
        })
    })

    test('falls back to the first name, then the numeric id', () => {
        expect(telegramActor({
            tgCtx: {update: {message: {from: {first_name: 'Alex'}}}},
        }).who).toBe('Alex')
        expect(telegramActor({
            tgCtx: {update: {message: {from: {id: 12345}}}},
        }).who).toBe('12345')
    })

    test('carries the update_id of a text command', () => {
        expect(telegramActor({
            tgCtx: {update: {update_id: 592011, message: {from: {}}}},
        }).id).toBe(592011)
    })

    // The update_id sits on the update, not on the callback query, so a button
    // tap is correlatable the same way a typed command is.
    test('carries the update_id of a button tap', () => {
        expect(telegramActor({
            tgCtx: {update: {update_id: 592012}, callbackQuery: {from: {}}},
        }).id).toBe(592012)
    })

    test('a chat with no title is a private chat', () => {
        expect(telegramActor({tgCtx: {}}).where).toBe('private')
    })
})

describe('formatCommandLog', () => {
    const actor = {src: 'dc/button', who: 'rainy', where: 'KARDS#general'}

    test('builds the full search line', () => {
        const line = formatCommandLog('search', actor, {
            q: 'zhukov', cache: 'MISS', page: 'p2 off5',
            result: '3 found', timings: {api: 76},
        })

        expect(segments(line)).toEqual([
            'search', 'dc/button', 'rainy@KARDS#general',
            'q="zhukov"', 'MISS', 'p2 off5', '3 found', 'api 76ms',
        ])
    })

    // Two lines with the same id are one interaction logged twice; two lines
    // with different ids are two deliveries.
    test('places the id right after who and where', () => {
        const line = formatCommandLog('search', {...actor, id: 592011},
            {q: 'чайка', cache: 'MISS'})

        expect(segments(line)).toEqual([
            'search', 'dc/button', 'rainy@KARDS#general', 'id 592011',
            'q="чайка"', 'MISS',
        ])
    })

    test('omits the id segment when the platform gave none', () => {
        expect(formatCommandLog('utc', actor, {})).not.toContain('id ')
    })

    test('does not drop an id of zero', () => {
        expect(formatCommandLog('search', {...actor, id: 0}, {}))
            .toContain('id 0')
    })

    test('omits every segment it has no value for', () => {
        expect(segments(formatCommandLog('utc', actor, {}))).toEqual([
            'utc', 'dc/button', 'rainy@KARDS#general',
        ])
    })

    test('prints timings in a fixed order, so two lines compare', () => {
        const line = formatCommandLog('deck', actor, {
            timings: {perm: 12, shot: 2114, usr: 3, db: 24},
        })

        expect(line.endsWith('db 24ms shot 2114ms usr 3.0ms perm 12ms')).toBe(true)
    })

    test('the platform is greppable from the source segment', () => {
        const tg = formatCommandLog(
            'search', {src: 'tg/text', who: 'alex', where: 'private'}, {})

        expect(tg).toContain(' · tg/text')
        expect(formatCommandLog('search', actor, {})).toContain(' · dc/button')
    })
})

describe('setLog / addTiming / logCommand', () => {
    let logged

    beforeEach(() => {
        logged = []
        jest.spyOn(console, 'log').mockImplementation(line => logged.push(line))
    })

    afterEach(() => {
        console.log.mockRestore()
    })

    test('setLog merges rather than replacing, so handlers can add detail', () => {
        const ctx = {}
        setLog(ctx, {cache: 'MISS'})
        setLog(ctx, {result: '3 found'})

        expect(ctx.log).toEqual({cache: 'MISS', result: '3 found'})
    })

    test('addTiming keeps the timings already measured', () => {
        const ctx = {timings: {perm: 12}}
        addTiming(ctx, 'cache', 4.2)

        expect(ctx.timings).toEqual({perm: 12, cache: 4.2})
    })

    test('addTiming creates the sink when there is none', () => {
        const ctx = {}
        addTiming(ctx, 'perm', 12)

        expect(ctx.timings).toEqual({perm: 12})
    })

    test('logCommand defaults the query to the command being run', () => {
        logCommand('help', {command: 'help'},
            {src: 'dc/text', who: 'rainy', where: 'DM'})

        expect(logged[0]).toContain('q="help"')
    })

    // A cache hit still spends time on permissions and the user lookup, so the
    // line has to report those too rather than looking instant.
    test('a cache hit reports every measured step, not just the cache', () => {
        const ctx = {command: 'zhukov', timings: {perm: 12, usr: 3, cache: 4.2}}
        setLog(ctx, {cache: 'HIT', page: 'p1'})
        logCommand('search', ctx, {src: 'dc/text', who: 'rainy', where: 'DM'})

        expect(logged[0]).toContain('cache 4.2ms usr 3.0ms perm 12ms')
    })

    test('exactly one line is written per interaction', () => {
        const ctx = {command: 'alt'}
        setLog(ctx, {cache: 'HIT'})
        logCommand('alt', ctx, {src: 'dc/text', who: 'rainy', where: 'DM'})

        expect(logged).toHaveLength(1)
    })
})
