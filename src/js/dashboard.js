async function renderChart() {
    try {
        //const response = await fetch('/data')
        //const data = await response.json()
        const data = { labels: ["Jan", "Feb", "Mar"], data: [10, 20, 30] }
        const ctx = document.getElementById('messagesChart').getContext('2d')
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Monthly Sales',
                    data: data.data,
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }]
            }
        })
    } catch (error) {
        console.error('Error fetching or rendering chart data:', error)
    }
}

renderChart().then( ()=> console.log('messagesChart rendered') )