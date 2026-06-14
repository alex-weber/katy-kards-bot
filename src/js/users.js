function confirmUserStatusToggle(input) {
    const form = input.closest('form')
    const nextLabel = input.checked ? 'activate' : 'deactivate'
    const username = input.dataset.username || 'this user'
    const confirmed = window.confirm(`Are you sure you want to ${nextLabel} ${username}?`)
    if (!confirmed) {
        input.checked = !input.checked
        return
    }
    form.submit()
}
