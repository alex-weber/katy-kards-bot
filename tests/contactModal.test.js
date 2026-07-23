// Unit tests for the "contact admins" modal builder, shared by the direct
// slash reply and the legacy button flow. No dependencies to mock.

const {buildContactModal} = require('../src/tools/contactModal')

describe('buildContactModal', () => {
    test('uses the fixed customId both flows submit to', () => {
        const modal = buildContactModal('en')
        expect(modal.data.custom_id).toBe('contact_admins_modal')
    })

    test('has one required paragraph input for the message', () => {
        const modal = buildContactModal('en')
        const row = modal.components[0]
        const input = row.components[0]

        expect(input.data.custom_id).toBe('contactMessage')
        expect(input.data.required).toBe(true)
        expect(input.data.style).toBe(2) // TextInputStyle.Paragraph
    })

    test('renders translated text for a known language', () => {
        const modal = buildContactModal('de')
        expect(modal.data.title).not.toBe('Contact Administrators')
    })
})
