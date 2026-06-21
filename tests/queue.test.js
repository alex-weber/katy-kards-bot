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

    test('runs up to `concurrency` tasks at the same time', async () => {
        const q = new RequestQueue(2)
        let running = 0
        let peak = 0
        const gates = []
        const finished = []

        for (let i = 0; i < 3; i++) {
            finished.push(new Promise(done => {
                q.enqueue(async () => {
                    running++
                    peak = Math.max(peak, running)
                    await new Promise(open => gates.push(open))
                    running--
                    done()
                })
            }))
        }

        // only 2 of the 3 tasks may be in flight at once
        while (gates.length < 2) await Promise.resolve()
        expect(q.active).toBe(2)
        expect(gates.length).toBe(2)

        // drain: opening a gate frees a slot, which admits the next task,
        // which registers its own gate — so keep opening until all 3 finish
        for (let i = 0; i < 3; i++) {
            while (gates.length) gates.shift()()
            await Promise.resolve()
            await Promise.resolve()
        }
        await Promise.all(finished)

        expect(peak).toBe(2)
    })
})
