class RequestQueue {
    /**
     * @param concurrency how many tasks may run at the same time (default 1,
     *        i.e. strictly serial FIFO processing)
     */
    constructor(concurrency = 1) {
        this.queue = []
        this.concurrency = Math.max(1, concurrency)
        this.active = 0
        // kept for backwards-compat / introspection: true while any task runs
        this.processing = false
    }

    enqueue(task) {
        this.queue.push(task)
        this.process()
    }

    process() {
        // launch workers until we hit the concurrency limit or run dry
        while (this.active < this.concurrency && this.queue.length > 0) {
            const task = this.queue.shift()
            this.active++
            this.processing = true
            this.runTask(task).then()
        }
    }

    async runTask(task) {
        try {
            await task()
        } catch (error) {
            console.error('Error processing task:', error)
        } finally {
            this.active--
            this.processing = this.active > 0
            // a slot just freed up, pull the next queued task in
            this.process()
        }
    }
}

module.exports = RequestQueue
