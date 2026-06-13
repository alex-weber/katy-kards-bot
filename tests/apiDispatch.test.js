// Tests for the API method dispatch + caching layer (src/controller/api.js).

const mockStore = new Map()

jest.mock('../src/controller/redis', () => ({
    cachePrefix: 'test:',
    redis: {
        json: {
            get: jest.fn(async key => (mockStore.has(key) ? mockStore.get(key) : null)),
            set: jest.fn(async (key, _path, value) => { mockStore.set(key, value) }),
        },
        expire: jest.fn(async () => {}),
    },
}))
jest.mock('../src/database/card', () => ({ getCardsByFaction: jest.fn(async () => [{ faction: 'usa' }]) }))
jest.mock('../src/database/message', () => ({
    getDashboardMessages: jest.fn(async () => [{ label: '01/01', count: 3 }]),
    getScreenshotMessages: jest.fn(async () => []),
    getTopMessages: jest.fn(async () => [{ command: 'leo', count: 5 }]),
    getTopUsers: jest.fn(async () => [{ username: 'Alice', count: 5 }]),
}))

const API = require('../src/controller/api')
const { redis } = require('../src/controller/redis')
const message = require('../src/database/message')

beforeEach(() => {
    mockStore.clear()
    jest.clearAllMocks()
})

describe('API.run', () => {
    test('unknown method returns 404', async () => {
        const res = await API.run('nope', {})
        expect(res.result).toBe(404)
        expect(res.success).toBe(false)
    })

    test('messages: computes on a cache miss and stores the result', async () => {
        const res = await API.run('messages', {period: 'monthly'})
        expect(res.success).toBe(true)
        expect(res.data).toEqual([{ label: '01/01', count: 3 }])
        expect(message.getDashboardMessages).toHaveBeenCalledTimes(1)
        expect(message.getDashboardMessages).toHaveBeenCalledWith({period: 'monthly'})
        expect(redis.json.set).toHaveBeenCalledTimes(1)
        expect(redis.expire).toHaveBeenCalledTimes(1) // default TTL applied
    })

    test('messages: serves from cache on a hit (no recompute)', async () => {
        await API.run('messages', {period: 'daily'})
        message.getDashboardMessages.mockClear()
        const res = await API.run('messages', {period: 'daily'})
        expect(res.success).toBe(true)
        expect(message.getDashboardMessages).not.toHaveBeenCalled()
    })

    test('different periods use different cache keys', async () => {
        await API.run('top-messages', {period: 'monthly'})
        await API.run('top-messages', {period: 'yearly'})
        expect(message.getTopMessages).toHaveBeenCalledTimes(2)
    })

    test('invalid stat period returns 400', async () => {
        const res = await API.run('messages', {period: 'weekly'})
        expect(res.result).toBe(400)
        expect(res.success).toBe(false)
        expect(message.getDashboardMessages).not.toHaveBeenCalled()
    })

    test('cards-by-faction caches forever (no expire)', async () => {
        await API.run('cards-by-faction', {})
        expect(redis.json.set).toHaveBeenCalledTimes(1)
        expect(redis.expire).not.toHaveBeenCalled() // ttl 0 => no expiry
    })

    test.each([
        ['screenshot-messages', 'getScreenshotMessages'],
        ['top-messages', 'getTopMessages'],
        ['top-users', 'getTopUsers'],
    ])('%s dispatches to %s and succeeds', async (method, fn) => {
        const res = await API.run(method, {period: 'quarterly'})
        expect(res.success).toBe(true)
        expect(message[fn]).toHaveBeenCalledTimes(1)
        expect(message[fn]).toHaveBeenCalledWith({period: 'quarterly'})
    })

    test('cards-by-faction served from cache on a hit', async () => {
        await API.run('cards-by-faction', {})
        const res = await API.run('cards-by-faction', {})
        expect(res.success).toBe(true)
        expect(res.data).toEqual([{ faction: 'usa' }])
    })
})
