// Toggle the text/redirect fields inside the radio's own .command-fields
// wrapper, so multiple command forms on the same page (the "New Command"
// panel plus one per existing row) don't interfere with each other.
function toggleSynonymContentType(radio) {
    const fields = radio.closest('.command-fields')
    const isRedirect = radio.value === 'redirect' && radio.checked
    fields.querySelector('.command-field-text').classList.toggle('d-none', isRedirect)
    fields.querySelector('.command-field-redirect').classList.toggle('d-none', !isRedirect)
}

// Built via DOM APIs rather than innerHTML so the uploaded URL never has to
// be treated as trusted markup.
function buildSynonymFileChip(url) {
    const chip = document.createElement('div')
    chip.className = 'command-file-chip'

    const hidden = document.createElement('input')
    hidden.type = 'hidden'
    hidden.name = 'files'
    hidden.value = url
    chip.appendChild(hidden)

    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = url
    chip.appendChild(link)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-sm btn-outline-danger ms-2'
    remove.textContent = 'Remove'
    remove.onclick = () => chip.remove()
    chip.appendChild(remove)

    return chip
}

// Uploads immediately via fetch (not the surrounding <form>'s own submit) so
// the image is already hosted, with its URL sitting in a hidden `files`
// input, by the time the admin fills in the rest of the command and saves.
// The upload endpoint is multipart, unlike every other admin form in this
// dashboard, so it needs the CSRF token as a header rather than a body field.
async function uploadSynonymImage(button) {
    const wrapper = button.closest('.command-file-upload')
    const fields = button.closest('.command-fields')
    const input = wrapper.querySelector('input[type="file"]')
    const status = fields.querySelector('.command-upload-status')
    const file = input.files[0]
    if (!file) return

    const csrfToken = document.getElementById('csrfToken').value
    const formData = new FormData()
    formData.append('image', file)

    status.textContent = 'Uploading...'
    button.disabled = true
    try {
        const response = await fetch('/commands/upload', {
            method: 'POST',
            headers: {'X-CSRF-Token': csrfToken},
            body: formData,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.url) {
            status.textContent = data.error || 'Upload failed'
            return
        }

        wrapper.before(buildSynonymFileChip(data.url))
        input.value = ''
        status.textContent = ''
    } catch (e) {
        status.textContent = 'Upload failed'
    } finally {
        button.disabled = false
    }
}

function confirmSynonymDelete(form) {
    const key = form.dataset.key || 'this command'
    return window.confirm(`Delete the custom command "${key}"? This cannot be undone.`)
}
