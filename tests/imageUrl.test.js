// Guards the host allowlist in front of every server-side image download.
// A stored custom command's files are fetched by the bot and posted back into
// the channel, so an unchecked URL here is a request forgery with the response
// delivered to whoever ran the command.

jest.mock('discord.js', () => ({PermissionsBitField: {Flags: {}}}))
jest.mock('../src/database/db', () => ({updateUser: jest.fn()}))
jest.mock('sharp', () => Object.assign(jest.fn(), {cache: jest.fn(), concurrency: jest.fn()}))

global.fetch = jest.fn()

const {safeImageUrl} = require('../src/tools/imageUrl')
const {downloadImageAsFile, cacheFileName} = require('../src/tools/imageUpload')

const discordUrl = 'https://cdn.discordapp.com/attachments/1/2/card.png'

// A Response standing in for a redirect to `location`, shaped like the one the
// download's manual redirect loop reads (a status in the 3xx range and a
// Headers.get('location')).
const redirectTo = (location) => ({
    status: 302,
    headers: {get: (name) => (name.toLowerCase() === 'location' ? location : null)},
})

describe('safeImageUrl', () => {
    test('passes a Discord attachment through', () => {
        expect(safeImageUrl(discordUrl)).toBe(discordUrl)
    })

    test('keeps the query string the CDN needs', () => {
        const signed = 'https://media.discordapp.net/attachments/1/2/c.png?ex=abc&is=def'

        expect(safeImageUrl(signed)).toBe(signed)
    })

    test.each([
        ['the cloud metadata service', 'http://169.254.169.254/latest/meta-data/'],
        ['a service on localhost', 'http://127.0.0.1:8080/admin'],
        ['a private address', 'http://10.0.0.5/'],
        ['an unrelated public host', 'https://evil.example.com/payload'],
        ['a lookalike host', 'https://cdn.discordapp.com.evil.example.com/x.png'],
    ])('refuses %s', (unused, url) => {
        expect(safeImageUrl(url)).toBeNull()
    })

    test('refuses a non-http protocol', () => {
        expect(safeImageUrl('file:///etc/passwd')).toBeNull()
        expect(safeImageUrl('ftp://cdn.discordapp.com/x.png')).toBeNull()
    })

    test('refuses an explicit port on an allowed host', () => {
        expect(safeImageUrl('https://cdn.discordapp.com:8080/x.png')).toBeNull()
    })

    test('refuses credentials smuggled into the authority', () => {
        expect(safeImageUrl('https://cdn.discordapp.com@evil.example.com/x.png')).toBeNull()
    })

    test('refuses anything that is not a URL', () => {
        expect(safeImageUrl('/etc/passwd')).toBeNull()
        expect(safeImageUrl(undefined)).toBeNull()
    })

    // Old stored commands predate HTTPS-only fetching.
    test('upgrades an allowed host to https', () => {
        expect(safeImageUrl('http://cdn.discordapp.com/attachments/1/2/c.png'))
            .toBe('https://cdn.discordapp.com/attachments/1/2/c.png')
    })

    // Where the uploader re-hosts every image a custom command stores — the one
    // host a deployment has to configure for its own commands to keep working.
    describe('IMAGE_ALLOWED_HOSTS', () => {
        const original = process.env.IMAGE_ALLOWED_HOSTS
        afterEach(() => { process.env.IMAGE_ALLOWED_HOSTS = original })

        test('allows a configured host', () => {
            process.env.IMAGE_ALLOWED_HOSTS = 'images.example.net'

            expect(safeImageUrl('https://images.example.net/uploads/x.webp'))
                .toBe('https://images.example.net/uploads/x.webp')
        })

        test('allows a configured wildcard and the domain itself', () => {
            process.env.IMAGE_ALLOWED_HOSTS = '*.example.net'

            expect(safeImageUrl('https://images.example.net/uploads/x.webp')).not.toBeNull()
            expect(safeImageUrl('https://example.net/uploads/x.webp')).not.toBeNull()
            expect(safeImageUrl('https://example.net.evil.example.com/x.webp')).toBeNull()
        })

        test('reads a list, ignoring the spacing', () => {
            process.env.IMAGE_ALLOWED_HOSTS = 'a.example.net , b.example.net'

            expect(safeImageUrl('https://b.example.net/x.webp')).not.toBeNull()
        })

        test('never drops the built-in Discord hosts', () => {
            process.env.IMAGE_ALLOWED_HOSTS = 'images.example.net'

            expect(safeImageUrl(discordUrl)).toBe(discordUrl)
        })
    })

    // A local-only escape hatch for a dev uploader on http://localhost:3200,
    // which the production guard (no port, https only) would otherwise refuse.
    describe('IMAGE_ALLOWED_INSECURE_HOSTS', () => {
        const originalHosts = process.env.IMAGE_ALLOWED_INSECURE_HOSTS
        const originalNodeEnv = process.env.NODE_ENV
        afterEach(() => {
            process.env.IMAGE_ALLOWED_INSECURE_HOSTS = originalHosts
            process.env.NODE_ENV = originalNodeEnv
        })

        test('passes a listed http host:port through untouched, off production', () => {
            delete process.env.NODE_ENV
            process.env.IMAGE_ALLOWED_INSECURE_HOSTS = 'localhost:3200'

            expect(safeImageUrl('http://localhost:3200/uploads/custom/20260808/x.png'))
                .toBe('http://localhost:3200/uploads/custom/20260808/x.png')
        })

        test('is inert in production even when the host is listed', () => {
            process.env.NODE_ENV = 'production'
            process.env.IMAGE_ALLOWED_INSECURE_HOSTS = 'localhost:3200'

            expect(safeImageUrl('http://localhost:3200/uploads/custom/x.png')).toBeNull()
        })

        test('only the exact host:port is lifted, not the bare host', () => {
            delete process.env.NODE_ENV
            process.env.IMAGE_ALLOWED_INSECURE_HOSTS = 'localhost:3200'

            expect(safeImageUrl('http://localhost:9999/x.png')).toBeNull()
        })

        test('still refuses smuggled credentials on a listed host', () => {
            delete process.env.NODE_ENV
            process.env.IMAGE_ALLOWED_INSECURE_HOSTS = 'localhost:3200'

            expect(safeImageUrl('http://user:pass@localhost:3200/x.png')).toBeNull()
        })
    })
})

// The Telegram path HEADs a stored command's image before forwarding it, which
// is the same URL from the same place — and the same forgery without a check.
describe('getFileSize', () => {
    const {getFileSize} = require('../src/controller/bot')

    beforeEach(() => jest.clearAllMocks())

    test('never issues the request for a refused host', async () => {
        await expect(getFileSize('http://127.0.0.1:9000/')).rejects.toThrow(/not allowed/i)
        expect(fetch).not.toHaveBeenCalled()
    })

    test('checks an allowed host over TLS', async () => {
        fetch.mockResolvedValueOnce({headers: {has: () => false}})

        await getFileSize(discordUrl)

        expect(fetch).toHaveBeenCalledWith(discordUrl, expect.objectContaining({method: 'HEAD'}))
    })
})

// A downloaded image is reused if a file is already sitting under the name this
// produces, so two images sharing a name means one is served in the other's
// place — the local name has to be as distinct as the URL is.
describe('cacheFileName', () => {
    const attachment = id => `https://cdn.discordapp.com/attachments/1/${id}/image.png`

    test('separates two images that share a basename', () => {
        expect(cacheFileName(attachment('111'))).not.toBe(cacheFileName(attachment('222')))
    })

    test('gives the same image the same name every time', () => {
        expect(cacheFileName(attachment('111'))).toBe(cacheFileName(attachment('111')))
    })

    // Discord re-signs attachment URLs; the path is what identifies the image,
    // so a fresh signature must not cost another download.
    test('ignores the query string', () => {
        expect(cacheFileName(attachment('111') + '?ex=aaa&is=bbb'))
            .toBe(cacheFileName(attachment('111') + '?ex=ccc&is=ddd'))
    })

    test('keeps the extension and a readable stem', () => {
        expect(cacheFileName(attachment('111'))).toMatch(/^image-[0-9a-f]{16}\.png$/)
    })

    test('still prefixes the language', () => {
        expect(cacheFileName(attachment('111'), 'de')).toMatch(/^de_image-/)
    })

    test('leaves off the extension when the URL has none', () => {
        expect(cacheFileName('https://cdn.discordapp.com/attachments/1/2/'))
            .toMatch(/^2-[0-9a-f]{16}$/)
    })

    test('is still a name when there is nothing to read off the URL', () => {
        expect(cacheFileName('https://cdn.discordapp.com')).toMatch(/^[0-9a-f]{16}$/)
    })

    test('never lets the URL shape into the file name', () => {
        const name = cacheFileName('https://cdn.discordapp.com/a/..%2f..%2fpasswd.png')

        expect(name).not.toMatch(/[/\\]/)
        expect(name).toMatch(/^[a-z0-9_.-]+$/i)
    })
})

describe('downloadImageAsFile', () => {
    beforeEach(() => jest.clearAllMocks())

    test('never issues the request for a refused host', async () => {
        await expect(downloadImageAsFile('http://169.254.169.254/latest/meta-data/'))
            .rejects.toThrow(/not allowed/i)
        expect(fetch).not.toHaveBeenCalled()
    })

    // An allowlisted host answering 302 would otherwise reach anywhere at all.
    test('refuses a redirect to a host off the allowlist', async () => {
        fetch.mockResolvedValueOnce(redirectTo('https://169.254.169.254/x.png'))

        await expect(downloadImageAsFile(discordUrl)).rejects.toThrow(/not allowed/i)
    })

    test('refuses a redirect that drops off TLS', async () => {
        fetch.mockResolvedValueOnce(redirectTo('http://cdn.discordapp.com/x.png'))

        await expect(downloadImageAsFile(discordUrl)).rejects.toThrow(/not allowed/i)
    })

    test('follows a redirect that stays on an allowed host', async () => {
        fetch
            .mockResolvedValueOnce(redirectTo('https://media.discordapp.net/x.png'))
            .mockRejectedValueOnce(new Error('stop here'))

        // The second hop is allowed, so the download proceeds to it and only
        // then fails — not on the allowlist check.
        await expect(downloadImageAsFile(discordUrl)).rejects.toThrow('stop here')
        expect(fetch).toHaveBeenCalledTimes(2)
    })
})
