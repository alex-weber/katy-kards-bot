class RequestQueue {
    constructor() {
        this.queue = []
        this.processing = false
    }

    enqueue(task) {
        this.queue.push(task)
        this.process()
    }

    async process() {
        if (this.processing) return
        this.processing = true

        while (this.queue.length > 0) {
            const task = this.queue.shift()
            try {
                await task()
            } catch (error) {
                console.error('Error processing task:', error)
            }
        }

        this.processing = false
    }
}

module.exports = RequestQueue