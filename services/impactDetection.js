function normalize(value) {
  const text = String(value).trim().replace(/\s+/g, ' ').toLowerCase();
  const date = Date.parse(text);
  if (!Number.isNaN(date)) return new Date(date).toISOString().slice(0, 10);
  return text;
}

function classifyMatch(storedValue, previousValue) {
  if (String(storedValue).trim() === String(previousValue).trim()) {
    return { confidence: 98, level: 'HIGH', reason: 'Exact match with the source value before correction.' };
  }
  if (normalize(storedValue) === normalize(previousValue)) {
    return { confidence: 82, level: 'MEDIUM', reason: 'Values match after safe whitespace, case, or date normalization.' };
  }
  return { confidence: 35, level: 'LOW', reason: 'Stored value differs from the previous source value; manual review is required.' };
}

function detectImpacts(sourceRecord, dependents) {
  return dependents
    .filter((record) => record.field_name.trim().toLowerCase() === sourceRecord.field_name.trim().toLowerCase())
    .filter((record) => record.stored_value !== sourceRecord.current_value)
    .map((record) => ({ dependent: record, ...classifyMatch(record.stored_value, sourceRecord.previous_value || '') }));
}

module.exports = { normalize, classifyMatch, detectImpacts };
