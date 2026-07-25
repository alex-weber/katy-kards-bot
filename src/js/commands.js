// Toggle the text/redirect fields inside the radio's own .command-fields
// wrapper, so the markup stays self-contained even though only the modal
// renders a command form these days.
function toggleSynonymContentType(radio) {
    const fields = radio.closest('.command-fields')
    const isRedirect = radio.value === 'redirect' && radio.checked
    fields.querySelector('.command-field-text').classList.toggle('d-none', isRedirect)
    fields.querySelector('.command-field-redirect').classList.toggle('d-none', !isRedirect)
}

// Built via DOM APIs rather than innerHTML so the uploaded URL never has to
// be treated as trusted markup. `inputName` decides how the server reads it
// back: images already stored on the command come back as `keepFiles` (the
// update route drops any it doesn't see), freshly uploaded ones as `files`.
function buildSynonymFileChip(url, inputName) {
    const chip = document.createElement('div')
    chip.className = 'command-file-chip'

    const hidden = document.createElement('input')
    hidden.type = 'hidden'
    hidden.name = inputName || 'files'
    hidden.value = url
    chip.appendChild(hidden)

    const link = document.createElement('a')
    link.className = 'command-file-link'
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener'

    const thumb = document.createElement('img')
    thumb.className = 'command-file-thumb'
    thumb.src = url
    thumb.alt = ''
    thumb.loading = 'lazy'
    link.appendChild(thumb)

    const label = document.createElement('span')
    label.className = 'command-file-name'
    label.textContent = url
    link.appendChild(label)
    chip.appendChild(link)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'command-action command-action-danger'
    remove.title = 'Remove image'
    remove.setAttribute('aria-label', 'Remove image')
    remove.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"'
        + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
        + ' stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
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

    // One line reports both progress and refusals — a refusal is why an image
    // would otherwise go missing from the saved command without explanation, so
    // it is coloured rather than left looking like another progress message.
    const setStatus = (text, isError = false) => {
        status.textContent = text
        status.classList.toggle('is-error', isError)
    }

    setStatus('Uploading...')
    button.disabled = true
    try {
        const response = await fetch('/commands/upload', {
            method: 'POST',
            headers: {'X-CSRF-Token': csrfToken},
            body: formData,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.url) {
            setStatus(data.error || 'Upload failed', true)
            return
        }

        fields.querySelector('#commandFileList').appendChild(buildSynonymFileChip(data.url, 'files'))
        input.value = ''
        setStatus('')
    } catch (e) {
        setStatus('Upload failed', true)
    } finally {
        button.disabled = false
    }
}

// One modal covers both create and update — the row's edit button carries the
// whole command as JSON in data-command, and its absence means "new command".
function fillCommandModal(command) {
    const form = document.getElementById('commandForm')
    const key = document.getElementById('commandKey')
    const isEdit = Boolean(command)

    form.action = isEdit ? `/commands/${encodeURIComponent(command.key)}` : '/commands'
    document.getElementById('commandModalTitle').textContent = isEdit ? 'Edit command' : 'New command'
    document.getElementById('commandModalSubtitle').textContent = isEdit
        ? 'Changes apply the next time the command is used.'
        : 'Reply with text, images, or redirect to a card search.'
    document.getElementById('commandSubmit').textContent = isEdit ? 'Save changes' : 'Create command'
    document.getElementById('commandModalIconNew').classList.toggle('d-none', isEdit)
    document.getElementById('commandModalIconEdit').classList.toggle('d-none', !isEdit)

    // The update route keys off the URL, so renaming isn't supported here —
    // an admin who wants a different key creates a new command.
    key.value = isEdit ? command.key : ''
    key.readOnly = isEdit
    document.getElementById('commandKeyHelp').textContent = isEdit
        ? 'The key of an existing command cannot be changed.'
        : 'Lowercase letters, numbers, spaces, - and _ only.'

    const isRedirect = isEdit && command.contentType === 'redirect'
    const typeRadio = document.getElementById(isRedirect ? 'commandTypeRedirect' : 'commandTypeText')
    typeRadio.checked = true
    toggleSynonymContentType(typeRadio)

    document.getElementById('commandText').value = isEdit ? command.text || '' : ''
    document.getElementById('commandRedirect').value = isEdit ? command.redirectTarget || '' : ''

    const fileList = document.getElementById('commandFileList')
    fileList.replaceChildren()
    if (isEdit) {
        for (const url of command.files || []) {
            fileList.appendChild(buildSynonymFileChip(url, 'keepFiles'))
        }
    }

    const status = form.querySelector('.command-upload-status')
    status.textContent = ''
    form.querySelector('.command-file-upload input[type="file"]').value = ''
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('commandModal')
    modal.addEventListener('show.bs.modal', event => {
        const raw = event.relatedTarget && event.relatedTarget.dataset.command
        fillCommandModal(raw ? JSON.parse(raw) : null)
    })
    modal.addEventListener('shown.bs.modal', () => {
        const key = document.getElementById('commandKey')
        if (!key.readOnly) key.focus()
    })

    const imageModal = document.getElementById('commandImageModal')
    imageModal.addEventListener('show.bs.modal', event => {
        const url = (event.relatedTarget && event.relatedTarget.dataset.image) || ''
        document.getElementById('commandImagePreview').src = url
        const link = document.getElementById('commandImageLink')
        link.href = url
        link.textContent = url
    })

    for (const thumb of document.querySelectorAll('.command-thumb')) {
        thumb.addEventListener('error', () => {
            thumb.closest('.command-thumb-btn').classList.add('command-thumb-broken')
        })
    }

    const deleteModal = document.getElementById('commandDeleteModal')
    deleteModal.addEventListener('show.bs.modal', event => {
        const key = (event.relatedTarget && event.relatedTarget.dataset.key) || ''
        document.getElementById('commandDeleteForm').action =
            `/commands/${encodeURIComponent(key)}/delete`
        document.getElementById('commandDeleteKey').textContent = key
    })
})
