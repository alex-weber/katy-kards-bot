const mockCreate = jest.fn(async () => ({}))
const mockQueryRaw = jest.fn()

jest.mock('../src/database/prisma', () => {
    const { Prisma } = jest.requireActual('@prisma/client')
    return {
        Prisma,
        prisma: {
            webAuditLog: { create: mockCreate },
            $queryRaw: mockQueryRaw,
        },
    }
})

const { createWebAudit, getWebAudits } = require('../src/database/webAudit')
const { summarizeSynonym, diffFields } = require('../src/tools/webAudit')

beforeEach(() => jest.clearAllMocks())

// $queryRaw is called as a tagged template: (strings, ...values), where values
// may themselves be nested Prisma.sql fragments.
function flattenQuery([strings, ...values]) {
    const sql = [strings.join('?'), ...values.map(value => (value && value.sql) || '')].join(' ')
    const params = values.flatMap(value => (value && value.values) || [value])
    return { sql, params }
}

describe('summarizeSynonym', () => {
    test('summarizes text, redirects and images', () => {
        expect(summarizeSynonym({ contentType: 'text', text: 'Hello\n  there', files: [] }))
            .toBe('text: "Hello there"')
        expect(summarizeSynonym({ contentType: 'redirect', redirectTarget: 'tiger', files: [] }))
            .toBe('redirect → tiger')
        expect(summarizeSynonym({ contentType: 'text', text: 'Hi', files: ['a', 'b'] }))
            .toBe('text: "Hi" + 2 images')
        expect(summarizeSynonym({ contentType: 'text', text: '', files: ['a'] })).toBe('1 image')
        expect(summarizeSynonym({ contentType: 'text', text: '', files: [] })).toBeNull()
    })

    test('truncates long text', () => {
        const summary = summarizeSynonym({ contentType: 'text', text: 'x'.repeat(200), files: [] })
        expect(summary.length).toBeLessThan(100)
        expect(summary).toContain('…')
    })
})

describe('diffFields', () => {
    test('returns only the fields that changed, as strings', () => {
        expect(diffFields({ a: 1, b: 2 }, { a: 1, b: 3 }))
            .toEqual([{ field: 'b', oldValue: '2', newValue: '3' }])
    })

    test('treats a missing side as null', () => {
        expect(diffFields(undefined, { a: 1 })).toEqual([{ field: 'a', oldValue: null, newValue: '1' }])
        expect(diffFields({ a: 1 }, undefined)).toEqual([{ field: 'a', oldValue: '1', newValue: null }])
    })
})

describe('createWebAudit', () => {
    test('stores the actor id and name', async () => {
        await createWebAudit({ actor: { id: 111, username: 'Katy' }, area: 'sync', action: 'start' })

        expect(mockCreate).toHaveBeenCalledWith({
            data: {
                actorId: '111', actor: 'Katy', area: 'sync', action: 'start',
                target: null, oldValue: null, newValue: null,
            },
        })
    })
})

describe('getWebAudits', () => {
    test('merges admin-made user changes in, filters and pages', async () => {
        mockQueryRaw
            .mockResolvedValueOnce([{ id: 1 }])
            .mockResolvedValueOnce([{ count: 51n }])

        const result = await getWebAudits({ page: 2, pageSize: 50, area: 'roles', actor: 'kat' })

        expect(result).toEqual({ entries: [{ id: 1 }], totalCount: 51 })
        const { sql, params } = flattenQuery(mockQueryRaw.mock.calls[0])
        expect(sql).toContain('"WebAuditLog"')
        expect(sql).toContain('"UserAuditLog"')
        expect(sql).toContain(`"actor" <> 'self'`)
        expect(params).toEqual(expect.arrayContaining(['roles', '%kat%', 50]))
    })

    test('ignores an unknown area', async () => {
        mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }])

        await getWebAudits({ area: 'nope' })

        expect(flattenQuery(mockQueryRaw.mock.calls[0]).params).not.toContain('nope')
    })
})
