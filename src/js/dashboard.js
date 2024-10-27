async function renderChart() {
    try {
        const response = await fetch('/api/cards-by-faction')
        const apiData = await response.json()
        console.log(apiData)
        const labels = apiData.data.map(item => item.faction)
        const dataPoints = apiData.data.map(item => item.count)

        //const data = await response.json()
        const ctx = document.getElementById('messagesChart').getContext('2d')
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Cards by faction',
                    data: dataPoints,
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