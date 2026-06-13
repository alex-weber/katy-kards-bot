const RequestQueue = require('../src/tools/queue')

describe('RequestQueue', () => {
    test('runs queued tasks in FIFO order', async () => {
        const q = new RequestQueue()
        const order = []
        const done = new Promise(resolve => {
            q.enqueue(async () => { order.push('a') })
            q.enqueue(async () => { order.push('b') })
            q.enqueue(async () => { order.push('c'); resolve() })
        })
        await done
        expect(order).toEqual(['a', 'b', 'c'])
    })

    test('keeps processing after a task throws', async () => {
        const q = new RequestQueue()
        jest.spyOn(console, 'error').mockImplementation(() => {})
        const order = []
        const done = new Promise(resolve => {
            q.enqueue(async () => { throw new Error('boom') })
            q.enqueue(async () => { order.push('after-error'); resolve() })
        })
        await done
        expect(order).toEqual(['after-error'])
        console.error.mockRestore()
    })

    test('processing flag resets so later enqueues still run', async () => {
        const q = new RequestQueue()
        await new Promise(resolve => q.enqueue(async () => resolve()))
        expect(q.processing).toBe(false)
        await new Promise(resolve => q.enqueue(async () => resolve()))
        expect(q.processing).toBe(false)
    })
})
