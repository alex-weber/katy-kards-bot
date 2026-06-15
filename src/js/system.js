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

const memoryTotalMb = 512
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

function memoryDisplayColor(value, thresholdMb, metricColor) {
    const numericValue = Number(value) || 0
    if (numericValue >= memoryTotalMb) return memoryTotalColor
    if (thresholdMb && numericValue >= thresholdMb) return memoryThresholdColor
    return metricColor
}

const memoryReferenceLines = {
    id: 'memoryReferenceLines',
    afterDraw(chart, args, options) {
        drawReferenceLine(chart, options.thresholdMb, memoryThresholdColor, `Threshold ${options.thresholdMb} MB`)
        drawReferenceLine(chart, memoryTotalMb, memoryTotalColor, `${memoryTotalMb} MB`)
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

function drawSystemMemoryChart(samples, thresholdMb) {
    const ctx = getSystemChart('systemMemoryChart')
    if (!ctx || !samples.length) return

    const maxSampleValue = samples.reduce((max, sample) => Math.max(
        max,
        Number(sample.rss) || 0,
        Number(sample.heapUsed) || 0,
        Number(sample.heapTotal) || 0,
        Number(sample.arrayBuffers) || 0
    ), 0)
    const suggestedMax = Math.ceil(Math.max(maxSampleValue, thresholdMb || 0, memoryTotalMb) * 1.12)
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
                                const displayColor = memoryDisplayColor(latestSample[metric], thresholdMb, metricColor)
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

function colorMemorySummary(samples, thresholdMb) {
    const latestSample = samples[samples.length - 1] || {}
    document.querySelectorAll('[data-memory-metric]').forEach(item => {
        const metric = item.dataset.memoryMetric
        const color = memoryDisplayColor(latestSample[metric], thresholdMb, memoryMetricColors[metric])
        item.style.borderColor = color
        item.querySelectorAll('.system-memory-label, .system-memory-value').forEach(element => {
            element.style.color = color
        })
    })
}

drawRedisChart(window.systemRedisData || {})
const systemMemorySamples = window.systemMemoryData || []
const systemMemoryThresholdMb = Number(window.systemMemoryThresholdMb) || 0
colorMemorySummary(systemMemorySamples, systemMemoryThresholdMb)
drawSystemMemoryChart(systemMemorySamples, systemMemoryThresholdMb)
