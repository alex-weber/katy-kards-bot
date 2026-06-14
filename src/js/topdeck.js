function tdColors(count) {
    const palette = [
        '#0d6efd',
        '#198754',
        '#ffc107',
        '#dc3545',
        '#20c997',
        '#6f42c1',
        '#fd7e14',
        '#0dcaf0',
        '#adb5bd',
        '#f8f9fa',
    ]
    return Array.from({ length: count }, (_, index) => palette[index % palette.length])
}

function getChart(canvasId) {
    const canvas = document.getElementById(canvasId)
    if (!canvas) return null
    return canvas.getContext('2d')
}

function drawTopScores(data) {
    const ctx = getChart('tdScoresChart')
    if (!ctx || !data.length) return

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(player => player.name),
            datasets: [{
                label: 'Score',
                data: data.map(player => player.score),
                backgroundColor: '#0d6efd',
                borderColor: '#6ea8fe',
                borderWidth: 1,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 150,
            animation: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    ticks: { color: '#dee2e6' },
                    grid: { color: '#343a40' },
                },
                y: {
                    ticks: { color: '#dee2e6' },
                    grid: { color: '#343a40' },
                },
            },
        },
    })
}

function drawOutcomes(data) {
    const ctx = getChart('tdOutcomesChart')
    if (!ctx || !data.length) return

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(item => item.label),
            datasets: [{
                data: data.map(item => item.count),
                backgroundColor: tdColors(data.length),
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
                legend: { position: 'bottom' },
            },
        },
    })
}

function drawActivity(data) {
    const ctx = getChart('tdActivityChart')
    if (!ctx || !data.length) return

    new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Players',
                data: data.map(player => ({
                    x: player.games,
                    y: player.winRatio,
                    label: player.name,
                })),
                backgroundColor: '#20c997',
                borderColor: '#75b798',
                pointRadius: 6,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 150,
            animation: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: context => {
                            const point = context.raw
                            return `${point.label}: ${point.x} games, WR ${point.y}`
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: 'Games', color: '#dee2e6' },
                    ticks: { color: '#dee2e6' },
                    grid: { color: '#343a40' },
                },
                y: {
                    min: 0,
                    max: 1,
                    title: { display: true, text: 'Win Ratio', color: '#dee2e6' },
                    ticks: { color: '#dee2e6' },
                    grid: { color: '#343a40' },
                },
            },
        },
    })
}

drawTopScores(topDeckChartData.topScores || [])
drawOutcomes(topDeckChartData.outcomes || [])
drawActivity(topDeckChartData.activity || [])
