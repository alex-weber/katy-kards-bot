describe('synonym cache settings', () => {
    afterEach(() => {
        jest.resetModules()
        jest.clearAllMocks()
        delete process.env.REDIS_EXP_SYNONYM
    })

    test('defaults cached synonym answers to 30 days', () => {
        process.env.REDIS_EXP_SYNONYM = ''
        jest.doMock('../src/controller/redis', () => ({
            cachePrefix: 'web-test:',
            redis: {
                scanIterator: jest.fn(async function* () {}),
                del: jest.fn(),
            },
        }))

        const {synonymCacheExp} = require('../src/controller/synonymCache')

        expect(synonymCacheExp).toBe(60 * 60 * 24 * 30)
    })

    test('uses configured synonym cache expiration when set', () => {
        process.env.REDIS_EXP_SYNONYM = '123'
        jest.doMock('../src/controller/redis', () => ({
            cachePrefix: 'web-test:',
            redis: {
                scanIterator: jest.fn(async function* () {}),
                del: jest.fn(),
            },
        }))

        const {synonymCacheExp} = require('../src/controller/synonymCache')

        expect(synonymCacheExp).toBe(123)
    })

    test('invalidates command-list and matching Discord synonym caches', async () => {
        const del = jest.fn()
        jest.doMock('../src/controller/redis', () => ({
            cachePrefix: 'web-test:',
            redis: {
                scanIterator: jest.fn(async function* () {
                    yield [
                        'discord:dev:guild:1:syn:foo',
                        'discord:dev:user_command:2:syn:foo',
                    ]
                }),
                del,
            },
        }))

        const {invalidateSynonymCache} = require('../src/controller/synonymCache')

        await invalidateSynonymCache('foo')

        expect(del).toHaveBeenCalledWith([
            'web-test:page:commands',
            'discord:dev:guild:1:syn:foo',
            'discord:dev:user_command:2:syn:foo',
        ])
    })
})

describe('handleSynonym cache invalidation', () => {
    const user = {role: 'VIP', name: 'manager'}
    const makeMessage = content => ({
        content,
        attachments: {size: 0},
    })

    let db
    let invalidateSynonymCache

    beforeEach(() => {
        jest.resetModules()
        jest.doMock('../src/database/db', () => ({
            getCardsDB: jest.fn(),
            getSynonym: jest.fn(),
            createSynonym: jest.fn(),
            updateSynonym: jest.fn(),
            deleteSynonym: jest.fn(),
            getAllSynonyms: jest.fn(),
        }))
        jest.doMock('../src/controller/synonymCache', () => ({
            invalidateSynonymCache: jest.fn(),
        }))
        jest.doMock('../src/tools/imageUpload', () => ({
            uploadImage: jest.fn(),
        }))
        jest.doMock('../src/tools/button', () => ({
            getButtonRow: jest.fn(),
        }))

        db = require('../src/database/db')
        invalidateSynonymCache =
            require('../src/controller/synonymCache').invalidateSynonymCache
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('invalidates when creating a synonym', async () => {
        db.getSynonym.mockResolvedValueOnce(null)
        const {handleSynonym} = require('../src/tools/search')

        await handleSynonym(user, makeMessage('!^foo=bar'))

        expect(db.createSynonym).toHaveBeenCalledWith(
            'foo', JSON.stringify({content: 'bar'}))
        expect(invalidateSynonymCache).toHaveBeenCalledWith('foo')
    })

    test('invalidates when updating a synonym to a different value', async () => {
        db.getSynonym.mockResolvedValueOnce({
            key: 'foo',
            value: JSON.stringify({content: 'old'}),
        })
        const {handleSynonym} = require('../src/tools/search')

        await handleSynonym(user, makeMessage('!^foo=bar'))

        expect(db.updateSynonym).toHaveBeenCalledWith(
            'foo', JSON.stringify({content: 'bar'}))
        expect(invalidateSynonymCache).toHaveBeenCalledWith('foo')
    })

    test('does not invalidate when updating to the same value', async () => {
        db.getSynonym.mockResolvedValueOnce({
            key: 'foo',
            value: JSON.stringify({content: 'bar'}),
        })
        const {handleSynonym} = require('../src/tools/search')

        await handleSynonym(user, makeMessage('!^foo=bar'))

        expect(db.updateSynonym).toHaveBeenCalledWith(
            'foo', JSON.stringify({content: 'bar'}))
        expect(invalidateSynonymCache).not.toHaveBeenCalled()
    })

    test('invalidates when deleting an existing synonym', async () => {
        db.getSynonym.mockResolvedValueOnce({
            key: 'foo',
            value: JSON.stringify({content: 'bar'}),
        })
        const {handleSynonym} = require('../src/tools/search')

        await handleSynonym(user, makeMessage('!^foo=delete'))

        expect(db.deleteSynonym).toHaveBeenCalledWith('foo')
        expect(invalidateSynonymCache).toHaveBeenCalledWith('foo')
    })
})
