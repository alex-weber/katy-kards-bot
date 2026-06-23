function parseSortableDate(value) {
    const parts = value.split('/')
    if (parts.length !== 3) return 0
    const [day, month, year] = parts.map(Number)
    return new Date(year || 0, (month || 1) - 1, day || 1).getTime() || 0
}

function cellSortValue(row, columnIndex, type) {
    const cell = row.cells[columnIndex]
    if (!cell) return type === 'text' ? '' : 0
    const value = cell.dataset.sortValue ?? cell.textContent.trim()
    if (type === 'number') return Number.parseFloat(value) || 0
    if (type === 'date') return parseSortableDate(value)
    return value.toLocaleLowerCase()
}

function makeTableSortable(table) {
    if (!table || !table.tBodies.length) return

    const tbody = table.tBodies[0]
    const headers = Array.from(table.tHead?.rows[0]?.cells || [])
    const defaultDirections = headers.map(header => header.dataset.sortType === 'text' ? 'asc' : 'desc')

    headers.forEach((header, columnIndex) => {
        const type = header.dataset.sortType
        if (!type) return

        header.classList.add('sortable-header')
        header.tabIndex = 0
        header.setAttribute('role', 'button')
        header.setAttribute('aria-sort', 'none')

        const sort = () => {
            const currentDirection = header.dataset.sortDirection
            const direction = currentDirection
                ? (currentDirection === 'asc' ? 'desc' : 'asc')
                : defaultDirections[columnIndex]
            const rows = Array.from(tbody.rows)

            rows.sort((a, b) => {
                const aValue = cellSortValue(a, columnIndex, type)
                const bValue = cellSortValue(b, columnIndex, type)
                const result = type === 'text'
                    ? aValue.localeCompare(bValue)
                    : aValue - bValue
                return direction === 'asc' ? result : -result
            })

            rows.forEach(row => tbody.appendChild(row))

            headers.forEach(item => {
                item.dataset.sortDirection = ''
                item.setAttribute('aria-sort', 'none')
            })
            header.dataset.sortDirection = direction
            header.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending')
        }

        header.addEventListener('click', sort)
        header.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            sort()
        })
    })
}

function initSortableTables() {
    document.querySelectorAll('table[data-sortable]').forEach(makeTableSortable)
}

initSortableTables()
