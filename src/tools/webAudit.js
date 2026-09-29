// Formatting helpers for the website activity log (WebAuditLog). They turn
// before/after state into the short display strings the Activity page shows.

const SUMMARY_TEXT_LENGTH = 80

/**
 * One-line summary of a custom command's content, from the fields
 * parseSynonymValue() returns: `text: "…"`, `redirect → …`, plus the number of
 * images. Null when there is nothing to show.
 *
 * @param parsed {contentType, text, redirectTarget, files}
 * @returns {string|null}
 */
function summarizeSynonym(parsed) {
    if (!parsed) return null

    const parts = []
    if (parsed.contentType === 'redirect' && parsed.redirectTarget) {
        parts.push(`redirect → ${truncate(parsed.redirectTarget)}`)
    } else if (parsed.text) {
        parts.push(`text: "${truncate(parsed.text.replace(/\s+/g, ' '))}"`)
    }
    const fileCount = Array.isArray(parsed.files) ? parsed.files.length : 0
    if (fileCount) parts.push(`${fileCount} image${fileCount === 1 ? '' : 's'}`)

    return parts.length ? parts.join(' + ') : null
}

function truncate(value) {
    return value.length > SUMMARY_TEXT_LENGTH ? value.slice(0, SUMMARY_TEXT_LENGTH - 1) + '…' : value
}

/**
 * The fields that differ between two flat settings objects, as
 * {field, oldValue, newValue} with string values; fields present on only one
 * side are compared against undefined, which renders as null.
 *
 * @param before
 * @param after
 * @returns {Array<{field: string, oldValue: string|null, newValue: string|null}>}
 */
function diffFields(before = {}, after = {}) {
    const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
    const changes = []
    for (const field of fields) {
        const oldValue = before?.[field]
        const newValue = after?.[field]
        if (String(oldValue) === String(newValue)) continue
        changes.push({
            field,
            oldValue: oldValue === undefined || oldValue === null ? null : String(oldValue),
            newValue: newValue === undefined || newValue === null ? null : String(newValue),
        })
    }
    return changes
}

module.exports = {
    summarizeSynonym,
    diffFields,
}
