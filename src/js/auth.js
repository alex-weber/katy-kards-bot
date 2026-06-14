window.onload = () => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const [accessToken, tokenType] = [fragment.get('access_token'), fragment.get('token_type')]
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content

    if (!accessToken || !csrfToken) {
        return (document.getElementById('login').style.display = 'block')
    }

    const form = document.createElement('form')
    form.method = 'post'
    form.action = '/login'

    for (const [name, value] of Object.entries({
        accessToken,
        tokenType,
        _csrf: csrfToken,
    })) {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        input.value = value || ''
        form.appendChild(input)
    }

    document.body.appendChild(form)
    form.submit()
}
