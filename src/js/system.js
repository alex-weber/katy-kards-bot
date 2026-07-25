function getSystemChart(canvasId) {
    const canvas = document.getElementById(canvasId)
    if (!canvas) return null
    return canvas.getContext('2d')
}

function formatMemoryTime(timestamp) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return timestamp
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
}

function drawReferenceLine(chart, value, color, label) {
    value = Number(value) || 0
    if (!value) return
    const yScale = chart.scales.y
    const area = chart.chartArea
    if (!yScale || !area || value < yScale.min || value > yScale.max) return

    const y = yScale.getPixelForValue(value)
    const ctx = chart.ctx
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(area.left, y)
    ctx.lineTo(area.right, y)
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.setLineDash([6, 4])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.font = '700 11px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, area.right - 4, y - 3)
    ctx.restore()
}

const memoryMetricColors = {
    rss: '#20c997',
    heapUsed: '#0d6efd',
    heapTotal: '#6f42c1',
    arrayBuffers: '#fd7e14',
}
const memoryMetricBackgrounds = {
    rss: 'rgba(32, 201, 151, 0.1)',
    heapUsed: 'rgba(13, 110, 253, 0.1)',
    heapTotal: 'rgba(111, 66, 193, 0.1)',
    arrayBuffers: 'rgba(253, 126, 20, 0.1)',
}
const memoryThresholdColor = '#ffc107'
const memoryTotalColor = '#dc3545'

function memoryDisplayColor(value, thresholdMb, availableMb, metricColor) {
    const numericValue = Number(value) || 0
    if (availableMb && numericValue >= availableMb) return memoryTotalColor
    if (thresholdMb && numericValue >= thresholdMb) return memoryThresholdColor
    return metricColor
}

const memoryReferenceLines = {
    id: 'memoryReferenceLines',
    afterDraw(chart, args, options) {
        drawReferenceLine(chart, options.thresholdMb, memoryThresholdColor, `Threshold ${options.thresholdMb} MB`)
        drawReferenceLine(chart, options.availableMb, memoryTotalColor, `Available ${options.availableMb} MB`)
    },
}

function drawRedisChart(cache) {
    const ctx = getSystemChart('systemRedisChart')
    if (!ctx) return

    const hits = Number(cache.hits) || 0
    const misses = Number(cache.misses) || 0
    if (hits + misses <= 0) return

    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: [`Hits (${cache.hitRatio || 0}%)`, `Misses (${cache.missRatio || 0}%)`],
            datasets: [{
                data: [hits, misses],
                backgroundColor: ['#20c997', '#dc3545'],
                borderColor: '#212529',
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 150,
            animation: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {color: '#dee2e6'},
                },
                tooltip: {
                    callbacks: {
                        label: context => `${context.label}: ${context.raw}`,
                    },
                },
            },
        },
    })
}

function drawSystemMemoryChart(samples, thresholdMb, availableMb) {
    const ctx = getSystemChart('systemMemoryChart')
    if (!ctx || !samples.length) return

    const maxSampleValue = samples.reduce((max, sample) => Math.max(
        max,
        Number(sample.rss) || 0,
        Number(sample.heapUsed) || 0,
        Number(sample.heapTotal) || 0,
        Number(sample.arrayBuffers) || 0
    ), 0)
    const suggestedMax = Math.ceil(Math.max(maxSampleValue, thresholdMb || 0, availableMb || 0) * 1.12)
    const latestSample = samples[samples.length - 1] || {}

    new Chart(ctx, {
        type: 'line',
        plugins: [memoryReferenceLines],
        data: {
            labels: samples.map(sample => formatMemoryTime(sample.timestamp)),
            datasets: [
                {
                    label: 'RSS',
                    metric: 'rss',
                    data: samples.map(sample => sample.rss),
                    backgroundColor: memoryMetricBackgrounds.rss,
                    borderColor: memoryMetricColors.rss,
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.25,
                },
                {
                    label: 'Heap Used',
                    metric: 'heapUsed',
                    data: samples.map(sample => sample.heapUsed),
                    backgroundColor: memoryMetricBackgrounds.heapUsed,
                    borderColor: memoryMetricColors.heapUsed,
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.25,
                },
                {
                    label: 'Heap Total',
                    metric: 'heapTotal',
                    data: samples.map(sample => sample.heapTotal),
                    backgroundColor: memoryMetricBackgrounds.heapTotal,
                    borderColor: memoryMetricColors.heapTotal,
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.25,
                },
                {
                    label: 'Array Buffers',
                    metric: 'arrayBuffers',
                    data: samples.map(sample => sample.arrayBuffers),
                    backgroundColor: memoryMetricBackgrounds.arrayBuffers,
                    borderColor: memoryMetricColors.arrayBuffers,
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.25,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 150,
            animation: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#dee2e6',
                        generateLabels: chart => {
                            const labels = Chart.defaults.plugins.legend.labels.generateLabels(chart)
                            labels.forEach(label => {
                                const dataset = chart.data.datasets[label.datasetIndex]
                                const metric = dataset.metric
                                const metricColor = memoryMetricColors[metric] || dataset.borderColor
                                const displayColor = memoryDisplayColor(
                                    latestSample[metric],
                                    thresholdMb,
                                    availableMb,
                                    metricColor)
                                label.fontColor = displayColor
                                label.strokeStyle = displayColor
                                label.fillStyle = displayColor
                            })
                            return labels
                        },
                    },
                },
                memoryReferenceLines: {
                    thresholdMb,
                    availableMb,
                },
                tooltip: {
                    callbacks: {
                        label: context => `${context.dataset.label}: ${context.raw} MB`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: {color: '#dee2e6'},
                    grid: {color: '#343a40'},
                },
                y: {
                    beginAtZero: true,
                    suggestedMax,
                    title: {display: true, text: 'MB', color: '#dee2e6'},
                    ticks: {color: '#dee2e6'},
                    grid: {color: '#343a40'},
                },
            },
        },
    })
}

function colorMemorySummary(samples, thresholdMb, availableMb) {
    const latestSample = samples[samples.length - 1] || {}
    document.querySelectorAll('[data-memory-metric]').forEach(item => {
        const metric = item.dataset.memoryMetric
        const color = memoryDisplayColor(latestSample[metric], thresholdMb, availableMb, memoryMetricColors[metric])
        item.style.borderColor = color
        item.querySelectorAll('.system-memory-label, .system-memory-value').forEach(element => {
            element.style.color = color
        })
    })
}

// --- Card database sync ---------------------------------------------------
// The sync runs as a child process on the server and takes minutes, so the
// button only kicks it off; everything after that comes from polling /system/sync.
// Polling backs off instead of using one fixed interval: a sync usually
// finishes in a few seconds, so a flat 10s made every run *look* like it took
// 10s. Starting at 500ms keeps short runs feeling immediate, and the backoff
// keeps a long run from burning the admin's WEB_RATE_LIMIT_MAX budget (300
// requests per 15 min by default) — capped at 10s, a 5 minute sync costs ~35.
const syncPollStartMs = 500
const syncPollMaxMs = 10000
const syncPollBackoff = 1.6
let syncPollTimer = null
let syncPollDelayMs = syncPollStartMs

// Durations, outcomes and the status line arrive pre-formatted from the server
// (src/tools/syncFormat.js) so this and system.pug can't drift apart.
// Timestamps are the exception: the server can only send UTC, and an admin
// wants to read them in their own timezone.
function formatSyncTimestamp(value, fallback) {
    const date = new Date(value)
    if (!value || Number.isNaN(date.getTime())) return fallback || '–'
    return date.toLocaleString([], {
        year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
}

function renderSyncHistory(history) {
    const body = document.getElementById('syncHistoryBody')
    const empty = document.getElementById('syncHistoryEmpty')
    if (!body) return

    body.textContent = ''
    empty.hidden = history.length > 0

    history.forEach(entry => {
        const row = document.createElement('tr')
        // Built via DOM APIs, not innerHTML — entry.error is whatever the
        // sync process reported and entry.triggeredBy is a Discord username.
        const cells = [
            entry.triggeredBy || 'unknown',
            formatSyncTimestamp(entry.finishedAt, entry.executed),
            entry.duration,
            entry.outcome,
        ]
        cells.forEach((text, index) => {
            const cell = document.createElement('td')
            cell.textContent = text
            if (index === 3 && !entry.ok) cell.className = 'system-sync-failed'
            row.appendChild(cell)
        })
        body.appendChild(row)
    })
}

function renderSyncState(state) {
    const button = document.getElementById('syncButton')
    const status = document.getElementById('syncStatus')
    const kicker = document.getElementById('syncKicker')
    if (!button) return

    const last = state.last || {}
    document.getElementById('syncLastRun').textContent = formatSyncTimestamp(last.finishedAt, last.executed)
    document.getElementById('syncCreated').textContent = last.finishedAt ? (last.created || 0) : '–'
    document.getElementById('syncUpdated').textContent = last.finishedAt ? (last.updated || 0) : '–'
    document.getElementById('syncDuration').textContent = last.duration || '–'
    renderSyncHistory(state.history || [])

    button.disabled = Boolean(state.running)
    button.textContent = state.running ? 'Syncing…' : 'Sync now'
    kicker.textContent = state.kicker || ''

    // The only line rebuilt here rather than taken from state.status: while a
    // sync runs without a progress line yet, the server can only date it in UTC.
    status.textContent = state.running && !state.progress
        ? 'Running since ' + formatSyncTimestamp(state.startedAt)
        : (state.status || '')
}

function stopSyncPolling() {
    if (syncPollTimer) clearTimeout(syncPollTimer)
    syncPollTimer = null
    syncPollDelayMs = syncPollStartMs
}

async function pollSyncState() {
    let stillRunning = true
    try {
        const response = await fetch('/system/sync')
        if (response.ok) {
            const state = await response.json()
            renderSyncState(state)
            stillRunning = Boolean(state.running)
        }
    } catch (e) {
        // A dropped poll is not worth surfacing — the next tick retries.
    }

    // Stop once it finishes; the button restarts the loop.
    if (!stillRunning) return stopSyncPolling()

    syncPollDelayMs = Math.min(Math.round(syncPollDelayMs * syncPollBackoff), syncPollMaxMs)
    syncPollTimer = setTimeout(pollSyncState, syncPollDelayMs)
}

function startSyncPolling() {
    if (syncPollTimer) return
    syncPollDelayMs = syncPollStartMs
    syncPollTimer = setTimeout(pollSyncState, syncPollDelayMs)
}

async function requestSync() {
    const button = document.getElementById('syncButton')
    const status = document.getElementById('syncStatus')
    button.disabled = true
    status.textContent = 'Starting…'

    try {
        const response = await fetch('/system/sync', {
            method: 'POST',
            headers: {'X-CSRF-Token': document.getElementById('csrfToken').value},
        })
        const state = await response.json().catch(() => ({}))
        if (!response.ok) {
            status.textContent = state.error || 'Could not start the sync'
            button.disabled = false
            return
        }
        renderSyncState(state)
        startSyncPolling()
    } catch (e) {
        status.textContent = 'Could not start the sync'
        button.disabled = false
    }
}

function initSyncWidget() {
    const button = document.getElementById('syncButton')
    if (!button) return

    const state = window.systemSyncState || {}
    renderSyncState(state)
    button.addEventListener('click', requestSync)
    if (state.running) startSyncPolling()
}

initSyncWidget()

drawRedisChart(window.systemRedisData || {})
const systemMemorySamples = window.systemMemoryData || []
const systemMemoryThresholdMb = Number(window.systemMemoryThresholdMb) || 0
const systemMemoryAvailableMb = Number(window.systemMemoryAvailableMb) || 0
colorMemorySummary(systemMemorySamples, systemMemoryThresholdMb, systemMemoryAvailableMb)
drawSystemMemoryChart(systemMemorySamples, systemMemoryThresholdMb, systemMemoryAvailableMb)
