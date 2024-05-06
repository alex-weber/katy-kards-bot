window.onload = () => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const [accessToken, tokenType] = [fragment.get('access_token'), fragment.get('token_type')]

    if (!accessToken) {
        return (document.getElementById('login').style.display = 'block')
    }
    window.location.replace(`/login?accessToken=${accessToken}&tokenType=${tokenType}`)
}